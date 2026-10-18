import { afterEach, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

const conversations = [{ username: 'bob', unread: 1 }];
vi.mock('../api.js', () => ({
  getDms: vi.fn(() => Promise.resolve(conversations)),
  getDmMessages: vi.fn(() => Promise.resolve([])),
}));
const api = await import('../api.js');
const { useDms } = await import('./useDms.js');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// `send` is stable in the app (useGateway), so it must be here too.
const send = vi.fn();
const setup = (active) =>
  renderHook((props) => useDms({ user: 'sandy', send, status: 'open', ...props }), {
    initialProps: { active },
  });

test('the conversation list loads whenever the DM view opens, however you got there', async () => {
  // e.g. clicking a DM notification while in a server: select + switch view.
  const { result, rerender } = setup(false);
  expect(api.getDms).not.toHaveBeenCalled();
  act(() => result.current.select('bob'));
  rerender({ active: true });
  await waitFor(() => expect(result.current.conversations).toEqual(conversations));
});

test('it loads when the app starts in the DM view (a reload while in DMs)', async () => {
  const { result } = setup(true);
  await waitFor(() => expect(result.current.conversations).toEqual(conversations));
});

test('not while you stay in a server', () => {
  const { rerender } = setup(false);
  rerender({ active: false });
  expect(api.getDms).not.toHaveBeenCalled();
});

test('starting a brand-new DM from a server keeps it in the list after the list loads', async () => {
  const { result, rerender } = setup(false);
  act(() => result.current.open('cara')); // no messages yet, so the server doesn't list her
  rerender({ active: true });
  await waitFor(() => expect(api.getDms).toHaveBeenCalled());
  await waitFor(() => expect(result.current.conversations.map((d) => d.username)).toEqual(['cara', 'bob']));
});

test('opening a DM with unread messages marks where the new ones start (once per visit)', async () => {
  const msgs = [
    { id: 1, author: 'bob', content: 'old' },
    { id: 2, author: 'sandy', content: 'mine' },
    { id: 3, author: 'bob', content: 'new 1' },
    { id: 4, author: 'bob', content: 'new 2' },
  ];
  api.getDmMessages.mockResolvedValue(msgs);
  const { result } = setup(true);
  act(() => result.current.handlers.dm_unread({ type: 'dm_unread', counts: [{ with: 'bob', count: 2 }] }));
  act(() => result.current.select('bob'));
  await waitFor(() => expect(result.current.newMessages).toEqual({ since: 2, count: 2 }));
  expect(send).toHaveBeenCalledWith({ op: 'dm_read', with: 'bob', lastId: 4 });
  act(() => result.current.select(''));
  expect(result.current.newMessages).toBeNull();
  api.getDmMessages.mockResolvedValue([]);
});
