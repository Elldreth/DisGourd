import { afterEach, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

// Each channel's history, served by the mocked API.
const history = {};
vi.mock('../api.js', () => ({
  getMessages: vi.fn((space, channel) => Promise.resolve(history[channel] || [])),
}));
const { useChannelMessages } = await import('./useChannelMessages.js');

afterEach(cleanup);

const msg = (id, channel, author = 'bob') => ({ id, space: 'S', channel, author, content: `m${id}`, timestamp: id });

function setup(channel) {
  const send = vi.fn();
  const hook = renderHook((props) => useChannelMessages({ active: true, user: 'sandy', send, status: 'open', ...props }), {
    initialProps: { space: 'S', channel },
  });
  return { ...hook, send };
}

test('opening a channel notes where you stopped reading, then marks it read', async () => {
  history.a = [msg(5, 'a'), msg(6, 'a'), msg(7, 'a')];
  history.b = [];
  const { result, rerender, send } = setup('b');
  act(() => result.current.handlers.unread({ counts: [{ space: 'S', channel: 'a', count: 2, lastReadId: 5 }] }));

  rerender({ space: 'S', channel: 'a' });
  await waitFor(() => expect(result.current.newMessages).toEqual({ since: 5, count: 2 }));
  expect(send).toHaveBeenCalledWith({ op: 'read', space: 'S', channel: 'a', lastId: 7 });

  // Leave and come back: everything was read, so no divider.
  rerender({ space: 'S', channel: 'b' });
  await waitFor(() => expect(result.current.newMessages).toBeNull());
  rerender({ space: 'S', channel: 'a' });
  await waitFor(() => expect(result.current.messages).toHaveLength(3));
  expect(result.current.newMessages).toBeNull();
});

test('a channel with nothing unread at connect gets its divider from the first live message', async () => {
  history.b = [];
  history.c = [msg(1, 'c'), msg(20, 'c'), msg(21, 'c')];
  const { result, rerender } = setup('b');
  act(() => result.current.handlers.unread({ counts: [] }));
  act(() => result.current.handlers.message(msg(20, 'c')));
  act(() => result.current.handlers.message(msg(21, 'c')));

  rerender({ space: 'S', channel: 'c' });
  await waitFor(() => expect(result.current.newMessages).toEqual({ since: 19, count: 2 }));
});
