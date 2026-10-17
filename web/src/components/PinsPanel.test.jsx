import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const pins = [
  { id: 9, author: 'ann', content: 'Rules: **be kind**', timestamp: new Date('2026-10-16T10:00:00').getTime(), pinnedBy: 'ann', pinnedAt: 2 },
  { id: 4, author: 'ben', content: '', attachments: ['/uploads/x/map.png'], timestamp: new Date('2026-10-15T10:00:00').getTime(), pinnedBy: 'ann', pinnedAt: 1 },
];
vi.mock('../api.js', () => ({ getPins: vi.fn(async () => pins) }));
const api = await import('../api.js');
const { default: PinsPanel } = await import('./PinsPanel.jsx');

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

test('lists the channel pins; clicking one jumps to it and closes', async () => {
  const onJump = vi.fn();
  const onClose = vi.fn();
  render(<PinsPanel space="S" channel="general" version={0} onJump={onJump} onClose={onClose} />);
  expect(screen.getByRole('dialog', { name: 'Pinned messages' })).toBeTruthy();
  await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2));
  expect(api.getPins).toHaveBeenCalledWith('S', 'general');
  expect(screen.getAllByRole('listitem')[0].textContent).toMatch(/ann.*Rules: be kind/s);
  expect(screen.getAllByRole('listitem')[1].textContent).toMatch(/Attachment/);
  fireEvent.click(screen.getByRole('button', { name: /Jump to ann's message/ }));
  expect(onClose).toHaveBeenCalled();
  expect(onJump).toHaveBeenCalledWith(9);
});

test('people allowed to pin can unpin from here', async () => {
  const onUnpin = vi.fn();
  render(<PinsPanel space="S" channel="general" version={0} canPin onUnpin={onUnpin} onJump={() => {}} onClose={() => {}} />);
  await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2));
  // Each Unpin says which message it is for.
  fireEvent.click(screen.getByRole('button', { name: "Unpin ben's message: Attachment" }));
  expect(onUnpin).toHaveBeenCalledWith(4);
});

test('it reloads when pins change, and says when there are none', async () => {
  const { rerender } = render(<PinsPanel space="S" channel="general" version={0} onJump={() => {}} onClose={() => {}} />);
  await waitFor(() => expect(api.getPins).toHaveBeenCalledTimes(1));
  api.getPins.mockResolvedValueOnce([]);
  await act(async () => {
    rerender(<PinsPanel space="S" channel="general" version={1} onJump={() => {}} onClose={() => {}} />);
  });
  await waitFor(() => expect(screen.getByText(/No pinned messages/)).toBeTruthy());
  expect(screen.queryAllByRole('button', { name: /^Unpin/ })).toHaveLength(0);
});
