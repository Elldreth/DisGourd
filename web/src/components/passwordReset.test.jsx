// P12-03: "Forgot password?" on the sign-in page, the page a reset link
// opens, and Settings › Site admin › People's "Reset link".
import { afterEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('../api.js', () => ({
  getAuthInfo: vi.fn(),
  login: vi.fn(),
  register: vi.fn(),
  setToken: vi.fn(),
  forgotPassword: vi.fn(),
  resetPassword: vi.fn(),
  makeResetLink: vi.fn(),
  searchUsers: vi.fn(),
  setSuspended: vi.fn(),
}));
vi.mock('../util.js', () => ({ copyText: vi.fn(async () => true) }));
const api = await import('../api.js');
const { copyText } = await import('../util.js');
const { default: Login } = await import('./Login.jsx');
const { default: ResetPassword } = await import('./ResetPassword.jsx');
const { default: PeopleAdmin } = await import('./PeopleAdmin.jsx');
const { captureResetToken } = await import('../emailLink.js');

const ANSWER = 'If that account has a confirmed email, a reset link is on its way. It expires in 30 minutes.';
const TOKEN = 'AbC_123-defghijklmnopqrstuvwxyz0123456789ab';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test('"Forgot password?" shows only when the server can send email', async () => {
  api.getAuthInfo.mockResolvedValue({ registration: 'open', email: false });
  render(<Login onAuthed={() => {}} />);
  await waitFor(() => expect(api.getAuthInfo).toHaveBeenCalled());
  expect(screen.queryByRole('button', { name: 'Forgot password?' })).toBeNull();
  cleanup();
  api.getAuthInfo.mockResolvedValue({ registration: 'open', email: true });
  render(<Login onAuthed={() => {}} />);
  expect(await screen.findByRole('button', { name: 'Forgot password?' })).toBeTruthy();
  // Not on the sign-up form.
  fireEvent.click(screen.getByRole('button', { name: 'Register' }));
  expect(screen.queryByRole('button', { name: 'Forgot password?' })).toBeNull();
});

test('forgot: the username carries over, the server’s answer is shown, then back to sign in', async () => {
  api.getAuthInfo.mockResolvedValue({ registration: 'open', email: true });
  api.forgotPassword.mockResolvedValue({ ok: true, message: ANSWER });
  render(<Login onAuthed={() => {}} />);
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: ' ruth ' } });
  fireEvent.click(await screen.findByRole('button', { name: 'Forgot password?' }));
  expect(screen.getByRole('heading', { name: 'Forgot your password?' })).toBeTruthy();
  expect(screen.getByLabelText('Username or email').value).toBe('ruth');
  fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
  expect((await screen.findByRole('status')).textContent).toBe(ANSWER);
  expect(api.forgotPassword).toHaveBeenCalledWith('ruth');
  expect(screen.getByText('No email address on the account? Ask a site admin for a reset link.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Back to sign in' }));
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
});

test('a reset link is read once from the address bar and taken out of it', () => {
  window.history.replaceState(null, '', `/#reset=${TOKEN}`);
  expect(captureResetToken()).toBe(TOKEN);
  expect(window.location.hash).toBe('');
  window.history.replaceState(null, '', '/#reset=short');
  expect(captureResetToken()).toBe('');
  window.history.replaceState(null, '', `/#confirm-email=${TOKEN}`);
  expect(captureResetToken()).toBe('');
  window.history.replaceState(null, '', '/');
});

test('the reset page checks both passwords match, then signs in with the new token', async () => {
  const onDone = vi.fn();
  api.resetPassword.mockResolvedValue({ ok: true, token: 'new-jwt' });
  render(<ResetPassword token={TOKEN} onDone={onDone} />);
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'squash-harvest-42' } });
  fireEvent.change(screen.getByLabelText('New password again'), { target: { value: 'squash-harvest-43' } });
  fireEvent.click(screen.getByRole('button', { name: 'Set new password' }));
  expect(await screen.findByText('The two passwords don’t match')).toBeTruthy();
  expect(api.resetPassword).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('New password again'), { target: { value: 'squash-harvest-42' } });
  fireEvent.click(screen.getByRole('button', { name: 'Set new password' }));
  await waitFor(() => expect(onDone).toHaveBeenCalledWith('new-jwt'));
  expect(api.resetPassword).toHaveBeenCalledWith(TOKEN, 'squash-harvest-42');
  expect(api.setToken).toHaveBeenCalledWith('new-jwt');
});

test('the reset page: a weak password can be tried again; a dead link says how to get a new one', async () => {
  const onDone = vi.fn();
  api.resetPassword.mockRejectedValueOnce(Object.assign(new Error('That password is too common'), { status: 400 }));
  render(<ResetPassword token={TOKEN} onDone={onDone} />);
  const fill = (v) => {
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: v } });
    fireEvent.change(screen.getByLabelText('New password again'), { target: { value: v } });
    fireEvent.click(screen.getByRole('button', { name: 'Set new password' }));
  };
  fill('password123');
  expect(await screen.findByText('That password is too common')).toBeTruthy();
  api.resetPassword.mockRejectedValueOnce(Object.assign(new Error('This link has expired or was already used'), { status: 400, code: 'TOKEN_INVALID' }));
  fill('squash-harvest-42');
  expect(await screen.findByRole('heading', { name: 'That link didn’t work' })).toBeTruthy();
  expect(screen.getByText('This link has expired or was already used')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Go to sign in' }));
  expect(onDone).toHaveBeenCalledWith('');
});

test('the reset page, opened in a signed-in tab, goes back to the app', async () => {
  api.resetPassword.mockRejectedValue(Object.assign(new Error('This link has expired or was already used'), { status: 400, code: 'TOKEN_INVALID' }));
  render(<ResetPassword token={TOKEN} signedIn onDone={() => {}} />);
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'squash-harvest-42' } });
  fireEvent.change(screen.getByLabelText('New password again'), { target: { value: 'squash-harvest-42' } });
  fireEvent.click(screen.getByRole('button', { name: 'Set new password' }));
  expect(await screen.findByRole('button', { name: 'Back to DisGourd' })).toBeTruthy();
});

test('the reset page: a suspended account is told it can’t sign in yet', async () => {
  api.resetPassword.mockResolvedValue({ ok: true, suspended: true });
  render(<ResetPassword token={TOKEN} onDone={() => {}} />);
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'squash-harvest-42' } });
  fireEvent.change(screen.getByLabelText('New password again'), { target: { value: 'squash-harvest-42' } });
  fireEvent.click(screen.getByRole('button', { name: 'Set new password' }));
  expect(await screen.findByText(/this account is suspended/)).toBeTruthy();
  expect(api.setToken).not.toHaveBeenCalled();
});

test('People: "Reset link" (not for site admins) asks first, then shows the full link once with Copy', async () => {
  const row = (username, siteAdmin = false) => ({ username, siteAdmin, suspended: false, suspendedAt: null, suspendedReason: null, lastSeenAt: null });
  api.searchUsers.mockResolvedValue({ users: [row('bob'), row('ada', true)] });
  api.makeResetLink.mockResolvedValue({ path: `/#reset=${TOKEN}`, expiresInHours: 24 });
  await act(async () => {
    render(<PeopleAdmin me="sandy" />);
  });
  await act(async () => {
    fireEvent.change(screen.getByLabelText('Find people'), { target: { value: 'b' } });
    fireEvent.submit(screen.getByRole('search'));
  });
  const [bob, ada] = screen.getAllByRole('listitem');
  expect(within(ada).queryByRole('button', { name: /reset link/i })).toBeNull();
  fireEvent.click(within(bob).getByRole('button', { name: 'Make a reset link for bob' }));
  expect(screen.getByText(/Anyone with the link can set a new password/)).toBeTruthy();
  expect(api.makeResetLink).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Make link' }));
  });
  expect(api.makeResetLink).toHaveBeenCalledWith('bob');
  const link = screen.getByLabelText('Reset link for bob');
  expect(link.value).toBe(`${window.location.origin}/#reset=${TOKEN}`);
  expect(screen.getByRole('status').textContent).toMatch(/works once, for 24 hours/);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
  });
  expect(copyText).toHaveBeenCalledWith(link.value);
  expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  expect(screen.queryByLabelText('Reset link for bob')).toBeNull();
});
