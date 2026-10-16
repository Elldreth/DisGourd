import { describe, expect, test } from 'vitest';
import { mergeMessages, formatDay, applyServerOrder, roleRank, attachmentInfo } from './util.js';

describe('mergeMessages', () => {
  test('adds new messages, replaces by id and keeps id order', () => {
    const existing = [{ id: 1, content: 'a' }, { id: 3, content: 'c' }];
    const incoming = [{ id: 2, content: 'b' }, { id: 3, content: 'c (edited)' }];
    expect(mergeMessages(existing, incoming)).toEqual([
      { id: 1, content: 'a' },
      { id: 2, content: 'b' },
      { id: 3, content: 'c (edited)' },
    ]);
  });

  test('ignores entries without an id', () => {
    expect(mergeMessages([{ id: 1 }], [null, { content: 'no id' }])).toEqual([{ id: 1 }]);
  });
});

describe('formatDay', () => {
  test('names today and yesterday', () => {
    expect(formatDay(Date.now())).toBe('Today');
    expect(formatDay(Date.now() - 24 * 60 * 60 * 1000)).toBe('Yesterday');
  });

  test('older dates get a full date; garbage gets nothing', () => {
    expect(formatDay(new Date(2025, 0, 2).getTime())).toMatch(/2025/);
    expect(formatDay('not a time')).toBe('');
  });
});

describe('applyServerOrder', () => {
  const list = [{ name: 'a' }, { name: 'b' }, { name: 'c' }];

  test('sorts by the saved order', () => {
    expect(applyServerOrder(list, ['c', 'a', 'b']).map((s) => s.name)).toEqual(['c', 'a', 'b']);
  });

  test('servers missing from the order go last, keeping their order', () => {
    expect(applyServerOrder(list, ['b']).map((s) => s.name)).toEqual(['b', 'a', 'c']);
  });

  test('no saved order leaves the list alone', () => {
    expect(applyServerOrder(list, [])).toBe(list);
  });
});

test('roleRank', () => {
  expect([roleRank('member'), roleRank('admin'), roleRank('owner'), roleRank(undefined)]).toEqual([1, 2, 3, 0]);
});

test('attachmentInfo recognises media and decodes names', () => {
  expect(attachmentInfo('/uploads/x/cat%20pic.PNG')).toMatchObject({ name: 'cat pic.PNG', ext: 'png', isImage: true, isMedia: true });
  expect(attachmentInfo('/uploads/x/notes.txt')).toMatchObject({ isImage: false, isVideo: false, isMedia: false });
});
