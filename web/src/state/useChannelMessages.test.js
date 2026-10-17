import { describe, expect, test, vi } from 'vitest';
import { messagesReducer, badgeCounts, pruneExpired, unreadKey, hasGap } from './useChannelMessages.js';

describe('messagesReducer', () => {
  const base = [
    { id: 1, content: 'one', reactions: [] },
    { id: 2, content: 'two', reactions: [{ emoji: '👍', count: 1, users: ['a'] }] },
  ];

  test('reset replaces the transcript', () => {
    expect(messagesReducer(base, { type: 'reset', messages: [{ id: 9 }] })).toEqual([{ id: 9 }]);
    expect(messagesReducer(base, { type: 'reset' })).toEqual([]);
  });

  test('merged adds older and newer messages in id order without duplicates', () => {
    const next = messagesReducer(base, { type: 'merged', messages: [{ id: 0, content: 'zero' }, { id: 2, content: 'two!' }] });
    expect(next.map((m) => m.id)).toEqual([0, 1, 2]);
    expect(next[2].content).toBe('two!');
  });

  test('updated edits one message', () => {
    const next = messagesReducer(base, { type: 'updated', id: 1, content: 'uno', editedAt: 5 });
    expect(next[0]).toMatchObject({ id: 1, content: 'uno', editedAt: 5 });
    expect(next[1]).toBe(base[1]);
  });

  test('deleted removes one message', () => {
    expect(messagesReducer(base, { type: 'deleted', id: 1 }).map((m) => m.id)).toEqual([2]);
  });

  test('reaction sets, replaces and clears one emoji', () => {
    let next = messagesReducer(base, { type: 'reaction', id: 1, emoji: '🔥', count: 1, users: ['b'] });
    expect(next[0].reactions).toEqual([{ emoji: '🔥', count: 1, users: ['b'] }]);
    next = messagesReducer(next, { type: 'reaction', id: 2, emoji: '👍', count: 2, users: ['a', 'b'] });
    expect(next[1].reactions).toEqual([{ emoji: '👍', count: 2, users: ['a', 'b'] }]);
    next = messagesReducer(next, { type: 'reaction', id: 2, emoji: '👍', count: 0, users: [] });
    expect(next[1].reactions).toEqual([]);
  });

  test('unknown actions change nothing', () => {
    expect(messagesReducer(base, { type: 'nope' })).toBe(base);
  });
});

test('pruneExpired drops expired entries and keeps the same object when nothing expired', () => {
  vi.spyOn(Date, 'now').mockReturnValue(1000);
  const fresh = { a: 2000 };
  expect(pruneExpired(fresh)).toBe(fresh);
  expect(pruneExpired({ a: 2000, b: 500 })).toEqual({ a: 2000 });
});

test('badgeCounts totals unread and mentions per channel and per server', () => {
  const spaces = [
    { name: 'S1', channels: ['general', 'random'] },
    { name: 'S2', channels: ['general'] },
  ];
  const unread = { [unreadKey('S1', 'random')]: 3, [unreadKey('S2', 'general')]: 1 };
  const mentions = { [unreadKey('S1', 'random')]: 1 };
  expect(badgeCounts({ unread, mentions, spaces, currentSpace: 'S1', channels: ['general', 'random'] })).toEqual({
    channelUnread: { random: 3 },
    channelMentions: { random: 1 },
    spaceUnread: { S1: 3, S2: 1 },
    spaceMentions: { S1: 1 },
  });
});

describe('resync after a reconnect', () => {
  const page = (...ids) => ids.map((id) => ({ id, content: `m${id}` }));

  test('replaces the overlap, drops deleted ones, keeps older pages', () => {
    // Loaded: an older page (1-3) and the newest (4-7). Offline: 5 edited, 6 deleted, 8 new.
    const state = page(1, 2, 3, 4, 5, 6, 7);
    const fresh = [{ id: 4, content: 'm4' }, { id: 5, content: 'edited' }, { id: 7, content: 'm7' }, { id: 8, content: 'm8' }];
    const next = messagesReducer(state, { type: 'resynced', messages: fresh, full: true });
    expect(next.map((m) => m.id)).toEqual([1, 2, 3, 4, 5, 7, 8]);
    expect(next.find((m) => m.id === 5).content).toBe('edited');
    expect(next[0]).toBe(state[0]); // older pages untouched
  });

  test('a short page is the whole conversation, so anything missing was deleted', () => {
    const next = messagesReducer(page(1, 2, 3), { type: 'resynced', messages: page(2, 3), full: false });
    expect(next.map((m) => m.id)).toEqual([2, 3]);
  });

  test('an empty page clears it (everything was deleted)', () => {
    expect(messagesReducer(page(1, 2), { type: 'resynced', messages: [], full: false })).toEqual([]);
  });

  test('hasGap: a full page that starts after everything we had means messages were missed in between', () => {
    expect(hasGap(page(1, 2, 3), page(10, 11), 2)).toBe(true);
    expect(hasGap(page(1, 2, 3), page(3, 4), 2)).toBe(false); // overlaps
    expect(hasGap(page(1, 2, 3), page(10), 2)).toBe(false); // short page: nothing older missing
    expect(hasGap([], page(10, 11), 2)).toBe(false);
  });
});
