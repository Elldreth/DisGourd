// P9-03: Settings › My account › Signed-in devices, and the sign-in page's
// note after another device signed this one out.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('../api.js', () => ({
  getSessions: vi.fn(),
  signOutSession: vi.fn(async () => ({ ok: true })),
  signOutOtherSessions: vi.fn(async () => ({ token: 'fresh-token' })),
  getAuthInfo: vi.fn(async () => ({ registration: 'open' })),
}));
const api = await import('../api.js');
const { default: DevicesSection, activeWords } = await import('./settings/DevicesSection.jsx');
const { default: Login } = await import('./Login.jsx');

const NOW = Date.now();
const list = (over = {}) => ({
  sessions: [
    { id: 'a', device: 'Chrome on Windows', createdAt: NOW - 2 * 86400e3, lastSeenAt: NOW - 30e3, current: true },
    { id: 'b', device: 'Safari on iPhone', createdAt: NOW - 5 * 86400e3, lastSeenAt: NOW - 3 * 3600e3, current: false },
  ],
  olderSignIns: false,
  ...over,
});
beforeEach(() => {
  vi.clearAllMocks();
  api.getSessions.mockResolvedValue(list());
});
afterEach(cleanup);

test('lists each device with when it signed in and was active; yours says This device', async () => {
  render(<DevicesSection />);
  const rows = within(await screen.findByRole('list', { name: 'Signed-in devices' })).getAllByRole('listitem');
  expect(rows).toHaveLength(2);
  expect(rows[0].textContent).toContain('Chrome on Windows');
  expect(within(rows[0]).getAllByText('This device').length).toBeGreaterThan(0);
  expect(within(rows[0]).queryByRole('button')).toBeNull();
  expect(rows[1].textContent).toContain('Safari on iPhone');
  expect(rows[1].textContent).toContain('Active 3 h ago');
  expect(within(rows[1]).getByRole('button', { name: 'Sign out Safari on iPhone' })).toBeTruthy();
  expect(screen.getByText(/aren’t listed/)).toBeTruthy();
});

test('Sign out signs that device out and reloads the list', async () => {
  render(<DevicesSection />);
  fireEvent.click(await screen.findByRole('button', { name: 'Sign out Safari on iPhone' }));
  await waitFor(() => expect(api.signOutSession).toHaveBeenCalledWith('b'));
  await waitFor(() => expect(api.getSessions).toHaveBeenCalledTimes(2));
  expect(screen.getByRole('status').textContent).toBe('Signed out.');
});

test('Sign out all other devices asks first, then keeps this device with its fresh token', async () => {
  const onToken = vi.fn();
  render(<DevicesSection onToken={onToken} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Sign out all other devices' }));
  expect(screen.getByRole('dialog', { name: 'Sign out all other devices?' })).toBeTruthy();
  expect(api.signOutOtherSessions).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Sign out others' }));
  await waitFor(() => expect(onToken).toHaveBeenCalledWith('fresh-token'));
  expect(screen.getByRole('status').textContent).toBe('Your other devices were signed out.');
});

test('with no other devices, Sign out all others is off unless older sign-ins may exist', async () => {
  api.getSessions.mockResolvedValue(list({ sessions: [list().sessions[0]] }));
  render(<DevicesSection />);
  expect((await screen.findByRole('button', { name: 'Sign out all other devices' })).disabled).toBe(true);
  cleanup();
  api.getSessions.mockResolvedValue(list({ sessions: [list().sessions[0]], olderSignIns: true }));
  render(<DevicesSection />);
  expect((await screen.findByRole('button', { name: 'Sign out all other devices' })).disabled).toBe(false);
});

test('"Active now" for the last two minutes', () => {
  expect(activeWords(NOW - 30e3, NOW)).toBe('Active now');
  expect(activeWords(NOW - 5 * 60e3, NOW)).toBe('Active 5 min ago');
});

test('the sign-in page says why when another device signed this one out', () => {
  render(<Login onAuthed={() => {}} notice="You were signed out of this device from another one." />);
  expect(screen.getByRole('status').textContent).toBe('You were signed out of this device from another one.');
  cleanup();
  render(<Login onAuthed={() => {}} />);
  expect(screen.queryByRole('status')).toBeNull();
});

test('the list reloads when the server says a device signed in or out', async () => {
  render(<DevicesSection />);
  await screen.findByRole('list', { name: 'Signed-in devices' });
  expect(api.getSessions).toHaveBeenCalledTimes(1);
  window.dispatchEvent(new Event('disgourd:sessions-changed'));
  await waitFor(() => expect(api.getSessions).toHaveBeenCalledTimes(2));
  cleanup();
  window.dispatchEvent(new Event('disgourd:sessions-changed')); // unmounted: no listener left
  expect(api.getSessions).toHaveBeenCalledTimes(2);
});
