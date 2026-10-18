import { describe, expect, test } from 'vitest';
import { newDivider, mergeLastRead, dmSince } from './newMessages.js';

const m = (id, author = 'bob') => ({ id, author });

describe('newDivider', () => {
  test('goes before the first message after where you stopped reading', () => {
    expect(newDivider([m(1), m(2), m(3), m(4)], 2, 'sandy', false)).toEqual({ id: 3, loaded: true });
  });

  test('skips your own messages', () => {
    expect(newDivider([m(1), m(2, 'sandy'), m(3)], 1, 'sandy', false)).toEqual({ id: 3, loaded: true });
  });

  test('none when everything new is yours, or nothing is new', () => {
    expect(newDivider([m(1), m(2, 'sandy')], 1, 'sandy', false)).toBeNull();
    expect(newDivider([m(1), m(2)], 2, 'sandy', false)).toBeNull();
    expect(newDivider([m(1), m(2)], null, 'sandy', false)).toBeNull();
  });

  test('not loaded yet when every loaded message is new and there is older history', () => {
    expect(newDivider([m(50), m(51)], 10, 'sandy', true)).toEqual({ id: null, loaded: false });
  });

  test('at the very start of a channel, the first message can be the divider', () => {
    expect(newDivider([m(1), m(2)], 0, 'sandy', false)).toEqual({ id: 1, loaded: true });
  });
});

describe('mergeLastRead', () => {
  test('keeps the higher of what we knew and what the server says', () => {
    const prev = { a: 10, b: 3 };
    expect(mergeLastRead(prev, { a: 7, b: 5, c: 1 })).toEqual({ a: 10, b: 5, c: 1 });
  });
});

describe('dmSince (P3-20b)', () => {
  const msgs = [
    { id: 10, author: 'bob' },
    { id: 11, author: 'me' },
    { id: 12, author: 'bob' },
    { id: 13, author: 'bob' },
  ];
  test('before the first of the partner’s newest `count` messages', () => {
    expect(dmSince(msgs, 1, 'me')).toBe(12);
    expect(dmSince(msgs, 2, 'me')).toBe(11);
    expect(dmSince(msgs, 3, 'me')).toBe(9);
  });
  test('more unread than loaded: just before the first loaded; none: null', () => {
    expect(dmSince(msgs, 7, 'me')).toBe(9);
    expect(dmSince(msgs, 0, 'me')).toBeNull();
    expect(dmSince([], 2, 'me')).toBeNull();
  });
});
