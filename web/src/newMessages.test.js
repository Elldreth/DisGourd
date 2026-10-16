import { describe, expect, test } from 'vitest';
import { newDivider, mergeLastRead } from './newMessages.js';

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
