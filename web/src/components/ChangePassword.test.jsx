// P6-02: Settings › My account › Change password — a small dialog that checks
// the new password locally, shows the server's errors, and hands back the
// fresh token.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('../api.js', () => ({
  changePassword: vi.fn(),
  getAdminRegistration: vi.fn(async () => ({ codes: [], admins: [] })),
  updateMe: vi.fn(),
  uploadFile: vi.fn(),
}));
const api = await import('../api.js');
const { default: ProfileDialog } = await import('./ProfileDialog.jsx');
const { default: ChangePasswordDialog } = await import('./ChangePasswordDialog.jsx');

beforeEach(() => {
  localStorage.clear();
  api.changePassword.mockReset();
});
afterEach(cleanup);

const fill = (current, next, confirm = next) => {
  fireEvent.change(screen.getByLabelText('Current password'), { target: { value: current } });
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: next } });
  fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: confirm } });
  const dialog = screen.getByRole('dialog', { name: 'Change password' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Change password' }));
};

test('My account has a Change password button that opens the dialog', async () => {
  render(<ProfileDialog profile={{ username: 'cara', email: 'c@example.test' }} onClose={() => {}} onUpdated={() => {}} onPasswordChanged={() => {}} />);
  expect(screen.getByText(/signs out your other devices/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
  expect(screen.getByRole('dialog', { name: 'Change password' })).toBeTruthy();
  await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Current password')));
});

test('too short, not matching, or unchanged: refused before anything is sent', () => {
  render(<ChangePasswordDialog onClose={() => {}} />);
  fill('old-password', 'short');
  expect(screen.getByRole('alert').textContent).toMatch(/at least 8/);
  fill('old-password', 'long-enough-1', 'long-enough-2');
  expect(screen.getByRole('alert').textContent).toMatch(/don’t match/);
  fill('same-password', 'same-password');
  expect(screen.getByRole('alert').textContent).toMatch(/different/);
  expect(api.changePassword).not.toHaveBeenCalled();
});

test("the server's error is shown and the dialog stays open", async () => {
  api.changePassword.mockRejectedValue(new Error('Your current password is incorrect'));
  const onClose = vi.fn();
  render(<ChangePasswordDialog onClose={onClose} />);
  fill('wrong-password', 'a-new-password');
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Your current password is incorrect'));
  expect(api.changePassword).toHaveBeenCalledWith('wrong-password', 'a-new-password');
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Change password' }).disabled).toBe(false);
});

test('success hands back the new token, closes, and says other devices were signed out', async () => {
  api.changePassword.mockResolvedValue({ token: 'new.token.here' });
  const onPasswordChanged = vi.fn();
  render(<ProfileDialog profile={{ username: 'cara', email: 'c@example.test' }} onClose={() => {}} onUpdated={() => {}} onPasswordChanged={onPasswordChanged} />);
  fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
  fill('old-password', 'a-new-password');
  await waitFor(() => expect(onPasswordChanged).toHaveBeenCalledWith('new.token.here'));
  expect(screen.queryByRole('dialog', { name: 'Change password' })).toBeNull();
  expect(screen.getByText(/Password changed\. Your other devices were signed out\./)).toBeTruthy();
});
