// P12-01: Settings › Site admin › Email — the status, today's counts, and a test send.
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

vi.mock('../api.js', () => ({
  getEmailStatus: vi.fn(),
  sendTestEmail: vi.fn(),
}));
const api = await import('../api.js');
const { default: EmailAdmin } = await import('./EmailAdmin.jsx');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const today = { sent: 3, failed: 1, overCap: 0, overRecipient: 2, pending: 0 };
const on = {
  enabled: true, missing: [], from: 'DisGourd <no-reply@example.com>', server: 'smtp.resend.com:587', tls: 'starttls',
  publicUrl: 'https://disgourd.example.com', dailyLimit: 90, today, lastError: { at: Date.now(), message: '535 bad credentials [redacted]' },
  yourAddress: 'owner@example.com',
};

test('email off: says so, lists the missing settings, and the test send is disabled', async () => {
  api.getEmailStatus.mockResolvedValue({ ...on, enabled: false, missing: ['SMTP_HOST', 'MAIL_FROM', 'PUBLIC_URL'], from: null, server: null, lastError: null, today: { ...today, sent: 0, failed: 0, overRecipient: 0 } });
  render(<EmailAdmin />);
  expect(await screen.findByText('Email is off')).toBeTruthy();
  const missing = screen.getByRole('list', { name: 'Missing settings' });
  expect(within(missing).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['SMTP_HOST', 'MAIL_FROM', 'PUBLIC_URL']);
  expect(screen.getByRole('button', { name: 'Send test email' }).disabled).toBe(true);
});

test('email on: where it sends from, today’s counts, the last error; a test goes to your own address or a typed one', async () => {
  api.getEmailStatus.mockResolvedValue(on);
  api.sendTestEmail.mockResolvedValueOnce({ queued: true, to: 'owner@example.com' }).mockRejectedValueOnce(new Error('That’s 5 test emails this hour. Try again later.'));
  render(<EmailAdmin />);
  expect(await screen.findByText('Email is set up')).toBeTruthy();
  expect(screen.getByText('DisGourd <no-reply@example.com>')).toBeTruthy();
  expect(screen.getByText('smtp.resend.com:587')).toBeTruthy();
  expect(screen.getByText('https://disgourd.example.com')).toBeTruthy();
  const counts = Object.fromEntries(screen.getAllByRole('term').map((dt) => [dt.textContent, dt.nextElementSibling.textContent]));
  expect(counts).toEqual({ Sent: '3', Failed: '1', 'Over the limit': '2', 'Daily limit': '90' });
  expect(screen.getByText('535 bad credentials [redacted]')).toBeTruthy();
  // Empty box: your own address.
  fireEvent.click(screen.getByRole('button', { name: 'Send test email' }));
  expect((await screen.findByRole('status')).textContent).toBe('Queued for owner@example.com. It should arrive within a minute (check spam too); if it fails, the error shows under Today.');
  expect(api.sendTestEmail).toHaveBeenLastCalledWith(undefined);
  // A typed address, refused by the limit.
  fireEvent.change(screen.getByLabelText(/^To \(/), { target: { value: ' friend@example.org ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send test email' }));
  expect((await screen.findByRole('alert')).textContent).toBe('That’s 5 test emails this hour. Try again later.');
  expect(api.sendTestEmail).toHaveBeenLastCalledWith('friend@example.org');
});
