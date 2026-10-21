import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

// P11-09: Settings › Privacy & safety › Who can message you.
vi.mock('../../api.js', () => ({
  getMe: vi.fn(async () => ({ dmPolicy: 'friends_and_servers' })),
  updateMe: vi.fn(async (patch) => ({ dmPolicy: patch.dmPolicy })),
}));
const api = await import('../../api.js');
const { default: DmPolicySection } = await import('./DmPolicySection.jsx');

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

test('shows the current choice and saves a change', async () => {
  await act(async () => {
    render(<DmPolicySection />);
  });
  const group = screen.getByRole('radiogroup', { name: 'Who can start a DM with you' });
  expect(group).toBeTruthy();
  expect(screen.getByRole('radio', { name: /Friends and people in your servers/ }).checked).toBe(true);
  await act(async () => {
    fireEvent.click(screen.getByRole('radio', { name: /Anyone on this site/ }));
  });
  expect(api.updateMe).toHaveBeenCalledWith({ dmPolicy: 'everyone' });
  expect(screen.getByRole('radio', { name: /Anyone on this site/ }).checked).toBe(true);
});

test('a failed save goes back and says so', async () => {
  api.updateMe.mockRejectedValueOnce(new Error('offline'));
  await act(async () => {
    render(<DmPolicySection />);
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('radio', { name: /Anyone on this site/ }));
  });
  expect(screen.getByRole('radio', { name: /Friends and people in your servers/ }).checked).toBe(true);
  expect(screen.getByRole('alert').textContent).toMatch(/Couldn’t save/);
});
