import { afterEach, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

// The channel's messages on the "server": ids 1-80. getMessages returns the
// newest 50, or the 50 before `before`.
let serverMsgs = [];
vi.mock('../api.js', () => ({
  getMessages: vi.fn((space, channel, { limit = 50, before } = {}) => {
    const rows = before ? serverMsgs.filter((m) => m.id < before) : serverMsgs;
    return Promise.resolve(rows.slice(-limit));
  }),
}));
const { useChannelMessages } = await import('./useChannelMessages.js');

afterEach(cleanup);

const msg = (id, content = `m${id}`) => ({ id, space: 'S', channel: 'a', author: 'bob', content, timestamp: id });

test('a reconnect refreshes the newest page and keeps older pages you scrolled to', async () => {
  serverMsgs = Array.from({ length: 80 }, (_, i) => msg(i + 1));
  const send = vi.fn();
  const { result, rerender } = renderHook(
    (props) => useChannelMessages({ space: 'S', channel: 'a', active: true, user: 'sandy', send, ...props }),
    { initialProps: { status: 'open' } }
  );
  await waitFor(() => expect(result.current.messages).toHaveLength(50));
  await act(() => result.current.loadOlder());
  expect(result.current.messages).toHaveLength(80);

  // While offline: 70 edited, 75 deleted, 81 posted.
  serverMsgs = serverMsgs.filter((m) => m.id !== 75).map((m) => (m.id === 70 ? msg(70, 'edited') : m));
  serverMsgs.push(msg(81));
  rerender({ status: 'reconnecting' });
  rerender({ status: 'open' });

  await waitFor(() => expect(result.current.messages.some((m) => m.id === 81)).toBe(true));
  const ids = result.current.messages.map((m) => m.id);
  expect(ids).toHaveLength(80); // 1-80, minus 75, plus 81
  expect(ids[0]).toBe(1); // the older page is still there
  expect(ids).not.toContain(75);
  expect(result.current.messages.find((m) => m.id === 70).content).toBe('edited');
});

test('if more than a page arrived while away, it reloads from scratch instead of leaving a hole', async () => {
  serverMsgs = Array.from({ length: 10 }, (_, i) => msg(i + 1));
  const { result, rerender } = renderHook(
    (props) => useChannelMessages({ space: 'S', channel: 'a', active: true, user: 'sandy', send: vi.fn(), ...props }),
    { initialProps: { status: 'open' } }
  );
  await waitFor(() => expect(result.current.messages).toHaveLength(10));

  for (let id = 11; id <= 100; id++) serverMsgs.push(msg(id));
  rerender({ status: 'reconnecting' });
  rerender({ status: 'open' });

  await waitFor(() => expect(result.current.messages.at(-1).id).toBe(100));
  const ids = result.current.messages.map((m) => m.id);
  expect(ids[0]).toBe(51); // just the newest page: no 1-10 followed by a jump to 51
  expect(result.current.hasMore).toBe(true);
});
