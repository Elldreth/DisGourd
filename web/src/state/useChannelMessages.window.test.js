import { afterEach, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

// P2-10: jumping to a message that isn't loaded swaps in a window of history
// around it; from there you can load newer pages or jump back to the present.
// The "server" has messages 1-120.
let serverMsgs = [];
vi.mock('../api.js', () => ({
  getMessages: vi.fn((space, channel, { limit = 50, before, after, around } = {}) => {
    if (around) {
      if (!serverMsgs.some((m) => m.id === around)) return Promise.reject(new Error('Message not found in this channel'));
      const older = serverMsgs.filter((m) => m.id < around).slice(-25);
      const rest = serverMsgs.filter((m) => m.id >= around).slice(0, 26);
      return Promise.resolve([...older, ...rest]);
    }
    if (after) return Promise.resolve(serverMsgs.filter((m) => m.id > after).slice(0, limit));
    const rows = before ? serverMsgs.filter((m) => m.id < before) : serverMsgs;
    return Promise.resolve(rows.slice(-limit));
  }),
}));
const { useChannelMessages } = await import('./useChannelMessages.js');

afterEach(cleanup);

const msg = (id, content = `m${id}`) => ({ id, space: 'S', channel: 'a', author: 'bob', content, timestamp: id });
const ids = (r) => r.current.messages.map((m) => m.id);

async function opened() {
  serverMsgs = Array.from({ length: 120 }, (_, i) => msg(i + 1));
  const send = vi.fn();
  const hook = renderHook((props) => useChannelMessages({ space: 'S', channel: 'a', active: true, user: 'sandy', send, ...props }), {
    initialProps: { status: 'open' },
  });
  await waitFor(() => expect(hook.result.current.messages).toHaveLength(50)); // 71-120
  return { ...hook, send };
}

test('jumping to an unloaded message shows the history around it, with more both ways', async () => {
  const { result } = await opened();
  expect(result.current.history.hasNewer).toBe(false);
  let ok;
  await act(async () => {
    ok = await result.current.history.jumpAround(30);
  });
  expect(ok).toBe(true);
  expect(ids(result)).toEqual(Array.from({ length: 51 }, (_, i) => 5 + i)); // 5-55
  expect(result.current.hasMore).toBe(true); // older than 5
  expect(result.current.history.hasNewer).toBe(true); // newer than 55
});

test('near the start, the window says there is nothing older', async () => {
  const { result } = await opened();
  await act(() => result.current.history.jumpAround(3));
  expect(ids(result)[0]).toBe(1);
  expect(result.current.hasMore).toBe(false);
});

test('a message that is not in the channel leaves the view alone', async () => {
  const { result } = await opened();
  let ok;
  await act(async () => {
    ok = await result.current.history.jumpAround(9999);
  });
  expect(ok).toBe(false);
  expect(ids(result)[0]).toBe(71);
  expect(result.current.history.hasNewer).toBe(false);
});

test('loading newer pages walks forward until the present', async () => {
  const { result } = await opened();
  await act(() => result.current.history.jumpAround(30)); // 5-55
  await act(() => result.current.history.loadNewer()); // +56-105
  expect(ids(result).at(-1)).toBe(105);
  expect(result.current.history.hasNewer).toBe(true);
  await act(() => result.current.history.loadNewer()); // +106-120, a short page
  expect(ids(result).at(-1)).toBe(120);
  expect(result.current.history.hasNewer).toBe(false); // back at the present
});

test('live messages wait while you read old history; Jump to present brings them in', async () => {
  const { result } = await opened();
  await act(() => result.current.history.jumpAround(30));
  serverMsgs.push(msg(121, 'new one'));
  act(() => result.current.handlers.message(msg(121, 'new one')));
  expect(ids(result)).not.toContain(121); // no gap-y append onto the old window
  await act(() => result.current.history.jumpToPresent());
  expect(ids(result).at(-1)).toBe(121);
  expect(ids(result)[0]).toBe(72); // the newest page
  expect(result.current.history.hasNewer).toBe(false);
});

test('a reconnect while reading old history keeps the window', async () => {
  const { result, rerender } = await opened();
  await act(() => result.current.history.jumpAround(30));
  rerender({ status: 'reconnecting' });
  rerender({ status: 'open' });
  await new Promise((r) => setTimeout(r, 20));
  expect(ids(result)[0]).toBe(5);
  expect(result.current.history.hasNewer).toBe(true);
});
