// P12-02: optional email at sign-up, Settings › My account › Email, the page a
// confirmation link opens, the "Confirm your email" step, and the admin switch.
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../api.js', () => ({
  getAuthInfo: vi.fn(),
  register: vi.fn(),
  login: vi.fn(),
  setToken: vi.fn(),
  changeEmail: vi.fn(),
  removeEmail: vi.fn(),
  resendEmailLink: vi.fn(),
  confirmEmail: vi.fn(),
  getMe: vi.fn(),
  getEmailStatus: vi.fn(),
  sendTestEmail: vi.fn(),
  setRequireConfirmedEmail: vi.fn(),
}));
const api = await import('../api.js');
const { default: Login } = await import('./Login.jsx');
const { default: EmailSection } = await import('./settings/EmailSection.jsx');
const { default: ConfirmEmailLink } = await import('./ConfirmEmailLink.jsx');
const { default: ConfirmEmailGate } = await import('./ConfirmEmailGate.jsx');
const { default: EmailAdmin } = await import('./EmailAdmin.jsx');
const { captureConfirmToken } = await import('../emailLink.js');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test('sign-up: email is optional, unless the server requires a confirmed one', async () => {
  api.getAuthInfo.mockResolvedValue({ registration: 'open', emailRequired: false });
  render(<Login onAuthed={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Register' }));
  expect(await screen.findByText('Email (optional, for password reset)')).toBeTruthy();
  expect(screen.getByPlaceholderText('you@example.com').required).toBe(false);
  cleanup();
  api.getAuthInfo.mockResolvedValue({ registration: 'open', emailRequired: true });
  render(<Login onAuthed={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Register' }));
  await waitFor(() => expect(screen.getByPlaceholderText('you@example.com').required).toBe(true));
  expect(screen.getByText('You’ll get a link to confirm it')).toBeTruthy();
});

test('My account › Email: add an address with your password; it waits on the link; send a new link', async () => {
  const onUpdated = vi.fn();
  api.changeEmail.mockResolvedValue({ email: null, emailVerified: false, emailPending: 'me@example.com', sent: true });
  const { rerender } = render(<EmailSection profile={{ email: null }} onUpdated={onUpdated} />);
  expect(screen.getByText('No email yet. Add one so you can reset your password.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Add email' }));
  fireEvent.change(screen.getByLabelText('Email', { selector: 'input' }), { target: { value: ' me@example.com ' } });
  fireEvent.change(screen.getByLabelText('Your password'), { target: { value: 'pw-12345678' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add and send link' }));
  expect((await screen.findByRole('status')).textContent).toBe('We sent a link to me@example.com. Your address changes once you open it.');
  expect(api.changeEmail).toHaveBeenCalledWith('me@example.com', 'pw-12345678');
  expect(onUpdated).toHaveBeenCalledWith({ email: null, emailVerified: false, emailPending: 'me@example.com' });
  rerender(<EmailSection profile={{ email: null, emailPending: 'me@example.com' }} onUpdated={onUpdated} />);
  api.resendEmailLink.mockResolvedValue({ email: null, emailVerified: false, emailPending: 'me@example.com' });
  fireEvent.click(screen.getByRole('button', { name: 'Send a new link' }));
  expect((await screen.findByRole('status')).textContent).toBe('A new link is on its way to me@example.com.');
});

test('My account › Email: confirmed, change shows the new-address form, remove asks for the password, a wrong one says so', async () => {
  api.removeEmail.mockRejectedValueOnce(new Error('Your password is incorrect')).mockResolvedValueOnce({ email: null, emailVerified: false, emailPending: null });
  render(<EmailSection profile={{ email: 'me@example.com', emailVerified: true }} onUpdated={() => {}} />);
  expect(screen.getByText('Confirmed')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Change' }));
  expect(screen.getByLabelText('New email')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Send link to the new address' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
  expect(screen.queryByLabelText('New email')).toBeNull();
  fireEvent.change(screen.getByLabelText('Your password'), { target: { value: 'nope-nope-1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Remove email' }));
  expect((await screen.findByRole('alert')).textContent).toBe('Your password is incorrect');
  fireEvent.click(screen.getByRole('button', { name: 'Remove email' }));
  expect((await screen.findByRole('status')).textContent).toBe('Email removed.');
});

test('a confirmation link: confirmed once, signed out; or expired, signed in, with a new link', async () => {
  api.confirmEmail.mockResolvedValue({ ok: true, email: 'me@example.com' });
  const onDone = vi.fn();
  render(<ConfirmEmailLink token="tok_abcdefghijklmnopqrstuvwxyz" signedIn={false} onDone={onDone} />);
  expect(await screen.findByRole('heading', { name: 'Email confirmed' })).toBeTruthy();
  expect(screen.getByText('me@example.com is now confirmed. It can be used to reset your password.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(onDone).toHaveBeenCalled();
  expect(api.confirmEmail).toHaveBeenCalledTimes(1);
  cleanup();
  api.confirmEmail.mockRejectedValue(new Error('This link has expired or was already used'));
  api.resendEmailLink.mockResolvedValue({ emailPending: 'me@example.com' });
  render(<ConfirmEmailLink token="tok_abcdefghijklmnopqrstuvwxyz" signedIn onDone={() => {}} />);
  expect(await screen.findByRole('heading', { name: 'That link didn’t work' })).toBeTruthy();
  expect(screen.getByText('This link has expired or was already used')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Send a new link' }));
  expect((await screen.findByRole('status')).textContent).toBe('A new link is on its way to me@example.com.');
});

test('the link token is read from the address bar once and taken out of it', () => {
  window.history.replaceState(null, '', '/#confirm-email=AbC_123-defghijklmnopqrstuv');
  expect(captureConfirmToken()).toBe('AbC_123-defghijklmnopqrstuv');
  expect(window.location.hash).toBe('');
  window.history.replaceState(null, '', '/#confirm-email=<script>');
  expect(captureConfirmToken()).toBe('');
  window.history.replaceState(null, '', '/');
  expect(captureConfirmToken()).toBe('');
});

test('"Confirm your email": where the link went, a new link, check again, another address, sign out', async () => {
  const onUpdated = vi.fn();
  const onSignOut = vi.fn();
  api.resendEmailLink.mockResolvedValue({ email: 'me@example.com', emailVerified: false, emailPending: 'me@example.com' });
  api.getMe.mockResolvedValue({ emailConfirmRequired: true });
  api.changeEmail.mockResolvedValue({ email: 'me@example.com', emailVerified: false, emailPending: 'new@example.com', sent: true });
  // An address with no link out yet: no "we sent" until one is sent.
  const { unmount } = render(<ConfirmEmailGate profile={{ email: 'me@example.com', emailConfirmRequired: true }} onUpdated={onUpdated} onSignOut={onSignOut} />);
  expect(screen.getByText('This server needs a confirmed email address, and me@example.com isn’t confirmed yet.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Send a confirmation link' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'I’ve opened the link' })).toBeNull();
  unmount();
  render(<ConfirmEmailGate profile={{ email: 'me@example.com', emailPending: 'me@example.com', emailConfirmRequired: true }} onUpdated={onUpdated} onSignOut={onSignOut} />);
  expect(screen.getByText('This server needs a confirmed email address. We sent a link to me@example.com; open it to continue.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Send a new link' }));
  expect((await screen.findByRole('status')).textContent).toBe('A new link is on its way to me@example.com.');
  fireEvent.click(screen.getByRole('button', { name: 'I’ve opened the link' }));
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Not confirmed yet. Open the link in the email, then check again.'));
  fireEvent.click(screen.getByRole('button', { name: 'Use a different address' }));
  fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'new@example.com' } });
  fireEvent.change(screen.getByLabelText('Your password'), { target: { value: 'pw-12345678' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send confirmation link' }));
  expect((await screen.findByRole('status')).textContent).toBe('We sent a link to new@example.com.');
  expect(api.changeEmail).toHaveBeenCalledWith('new@example.com', 'pw-12345678');
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  expect(onSignOut).toHaveBeenCalled();
});

test('Site admin › Email: the "Require a confirmed email" switch, off while email is off', async () => {
  const status = { enabled: true, missing: [], from: 'a@example.com', server: 'smtp.example.com:587', tls: 'starttls', publicUrl: 'https://x.example', dailyLimit: 90, today: { sent: 0, failed: 0, overCap: 0, overRecipient: 0, pending: 0 }, lastError: null, yourAddress: null, requireConfirmed: false };
  api.getEmailStatus.mockResolvedValue(status);
  api.setRequireConfirmedEmail.mockResolvedValue({ ...status, requireConfirmed: true });
  render(<EmailAdmin />);
  const sw = await screen.findByRole('switch', { name: 'Require a confirmed email' });
  expect(sw.checked).toBe(false);
  fireEvent.click(sw);
  await waitFor(() => expect(screen.getByRole('switch', { name: 'Require a confirmed email' }).checked).toBe(true));
  expect(api.setRequireConfirmedEmail).toHaveBeenCalledWith(true);
  cleanup();
  api.getEmailStatus.mockResolvedValue({ ...status, enabled: false, missing: ['SMTP_HOST'] });
  render(<EmailAdmin />);
  expect((await screen.findByRole('switch', { name: 'Require a confirmed email' })).disabled).toBe(true);
  expect(screen.getByText('Set up email first: nobody could confirm an address while it’s off.')).toBeTruthy();
});

test('the new screens: every control has a name in words', async () => {
  const { computeAccessibleName } = await import('dom-accessibility-api');
  const unnamed = () => [...document.body.querySelectorAll('button, input, [role=switch]')]
    .filter((el) => !/\p{L}/u.test(computeAccessibleName(el)))
    .map((el) => el.outerHTML.slice(0, 100));
  api.resendEmailLink.mockResolvedValue({});
  render(<EmailSection profile={{ email: 'me@example.com', emailVerified: false }} onUpdated={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Change' }));
  render(<ConfirmEmailGate profile={{ email: 'me@example.com', emailPending: 'me@example.com' }} onUpdated={() => {}} onSignOut={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Use a different address' }));
  expect(unnamed()).toEqual([]);
});
