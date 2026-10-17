import { afterEach, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

// P2-22b: a second useChannelMessages shows the open thread ('~tN'). It only
// handles its own frames, and the channel's instance keeps thread summaries
// live under root messages.
vi.mock('../api.js', () => ({
  getMessages: vi.fn(() => Promise.resolve([{ id: 40, space: 'S', channel: '~t7', author: 'bob', content: 'a reply', timestamp: 40 }])),
}));
const { useChannelMessages, messagesReducer, isThreadChannel, threadRootId } = await import('./useChannelMessages.js');

afterEach(cleanup);

test('thread channel names', () => {
  expect(isThreadChannel('~t12')).toBe(true);
  expect(isThreadChannel('general')).toBe(false);
  expect(threadRootId('~t12')).toBe(12);
  expect(threadRootId('general')).toBeNull();
});

test('the thread instance posts and reads with channel ~tN, and leaves the gateway focus alone', async () => {
  const send = vi.fn();
  const onIncoming = vi.fn();
  const { result } = renderHook(() =>
    useChannelMessages({ space: 'S', channel: '~t7', active: true, user: 'sandy', send, status: 'open', onIncoming, threadOnly: true })
  );
  await waitFor(() => expect(result.current.messages.map((m) => m.id)).toEqual([40]));
  expect(send.mock.calls.map((c) => c[0].op)).toEqual(['read']); // no 'focus'
  act(() => result.current.sendMessage('hi', [], false, 40));
  expect(send).toHaveBeenLastCalledWith({ op: 'message', space: 'S', channel: '~t7', content: 'hi', attachments: [], spoiler: false, replyTo: 40 });

  // Its own replies come in; other channels' messages and the unread frame are ignored.
  act(() => {
    result.current.handlers.message({ id: 41, space: 'S', channel: '~t7', author: 'bob', content: 'another', timestamp: 41 });
    result.current.handlers.message({ id: 42, space: 'S', channel: 'general', author: 'bob', content: 'elsewhere', timestamp: 42 });
    result.current.handlers.unread({ counts: [{ space: 'S', channel: 'general', count: 3 }] });
  });
  expect(result.current.messages.map((m) => m.id)).toEqual([40, 41]);
  expect(result.current.unread).toEqual({});
  expect(onIncoming).not.toHaveBeenCalled();
});

test('the channel instance ignores thread replies and keeps root summaries live', async () => {
  const send = vi.fn();
  const onIncoming = vi.fn();
  const { result } = renderHook(() =>
    useChannelMessages({ space: 'S', channel: 'general', active: true, user: 'sandy', send, status: 'open', onIncoming })
  );
  await waitFor(() => expect(result.current.messages).toHaveLength(1));
  act(() => {
    // A reply in a thread: no notification, no unread (that comes with P2-22c).
    result.current.handlers.message({ id: 50, space: 'S', channel: '~t40', author: 'bob', content: 'reply', mentions: ['sandy'], timestamp: 50 });
  });
  expect(onIncoming).not.toHaveBeenCalled();
  expect(result.current.unread).toEqual({});
  expect(result.current.mentions).toEqual({});

  const before = result.current.threadsVersion;
  act(() => {
    result.current.handlers.thread_created({
      space: 'S', channel: 'general',
      thread: { id: 3, channel: '~t40', name: 'Plans', rootMessageId: 40, messageCount: 0, lastActivityAt: 1, parentChannel: 'general', createdBy: 'bob' },
    });
  });
  expect(result.current.messages[0].thread).toEqual({ id: 3, channel: '~t40', name: 'Plans', messageCount: 0, lastActivityAt: 1 });
  act(() => {
    result.current.handlers.thread_updated({ space: 'S', channel: 'general', rootMessageId: 40, thread: { id: 3, channel: '~t40', name: 'Plans', messageCount: 2, lastActivityAt: 9 } });
    result.current.handlers.thread_updated({ space: 'S', channel: 'other', rootMessageId: 40, thread: { id: 4, channel: '~t40', name: 'Not here', messageCount: 9 } });
  });
  expect(result.current.messages[0].thread).toMatchObject({ messageCount: 2, lastActivityAt: 9, name: 'Plans' });
  expect(result.current.threadsVersion).toBe(before + 2);
});

test('the reducer sets and clears a thread summary', () => {
  const state = [{ id: 1 }, { id: 2 }];
  const next = messagesReducer(state, { type: 'thread', id: 2, thread: { name: 'x' } });
  expect(next[1].thread).toEqual({ name: 'x' });
  expect(next[0]).toBe(state[0]);
  expect(messagesReducer(next, { type: 'thread', id: 2, thread: null })[1].thread).toBeNull();
});
