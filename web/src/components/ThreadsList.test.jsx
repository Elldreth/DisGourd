import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const active = [{ id: 3, channel: '~t7', name: 'Weekend plans', messageCount: 2, lastActivityAt: Date.now(), createdBy: 'bob', followed: true, archived: false }];
const archived = [{ id: 2, channel: '~t4', name: 'Old news', messageCount: 5, lastActivityAt: Date.now() - 9 * 86400000, createdBy: 'ann', followed: false, archived: true }];
vi.mock('../api.js', () => ({ getThreads: vi.fn(async (space, channel, arch) => (arch ? archived : active)) }));
const api = await import('../api.js');
const { default: ThreadsList } = await import('./ThreadsList.jsx');

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

test('lists the active threads; the Archived toggle shows the archived ones (P2-22d)', async () => {
  const onOpen = vi.fn();
  const onClose = vi.fn();
  render(<ThreadsList space="S" channel="general" version={0} onOpen={onOpen} onClose={onClose} />);
  await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
  expect(api.getThreads).toHaveBeenLastCalledWith('S', 'general', false);
  expect(screen.getByRole('button', { name: 'Open thread Weekend plans, 2 replies, following' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Archived' }));
  await waitFor(() => expect(api.getThreads).toHaveBeenLastCalledWith('S', 'general', true));
  const row = await screen.findByRole('button', { name: 'Open thread Old news, 5 replies' });
  expect(row.textContent).toContain('· archived');
  fireEvent.click(row);
  expect(onClose).toHaveBeenCalled();
  expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ channel: '~t4', archived: true }));
});
