import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { loadEmoji, searchEmoji, getRecentEmoji, addRecentEmoji, insertAtCaret, EMOJI_GROUPS } from './emoji.js';

let list;
// Emoji are stored fully qualified (👍 is 👍 + U+FE0F, "show as emoji").
const bare = (e) => e.replace(/\uFE0F/g, '');
const found = (q) => searchEmoji(list, q).map((e) => bare(e.emoji));
beforeAll(async () => {
  list = await loadEmoji();
});
beforeEach(() => localStorage.clear());

describe('loadEmoji', () => {
  test('loads the emoji in order, without regional letters or skin-tone swatches', () => {
    expect(list.length).toBeGreaterThan(1500);
    expect(list[0].emoji).toBe('😀');
    expect(list.some((e) => e.label.startsWith('regional indicator'))).toBe(false);
    expect(list.every((e) => EMOJI_GROUPS.some((g) => g.id === e.group))).toBe(true);
  });

  test('loads once', async () => {
    expect(await loadEmoji()).toBe(list);
  });
});

describe('searchEmoji', () => {
  test('"fire" finds 🔥 first, "thumbs" finds 👍', () => {
    expect(found('fire')[0]).toBe('🔥');
    expect(found('thumbs')).toContain('👍');
  });

  test('matches shortcodes and tags too, ignoring case and colons', () => {
    expect(found(':+1:')[0]).toBe('👍');
    expect(found('LIT')).toContain('🔥');
  });

  test('an empty search finds nothing (the picker shows categories instead)', () => {
    expect(searchEmoji(list, '  ')).toEqual([]);
  });
});

describe('recent emoji', () => {
  test('newest first, no repeats, at most 24, and kept across reloads', () => {
    addRecentEmoji('🔥');
    addRecentEmoji('👍');
    addRecentEmoji('🔥');
    expect(getRecentEmoji()).toEqual(['🔥', '👍']);
    for (let i = 0; i < 30; i++) addRecentEmoji(String.fromCodePoint(0x1f600 + i));
    expect(getRecentEmoji()).toHaveLength(24);
    expect(JSON.parse(localStorage.getItem('disgourd.recentEmoji'))[0]).toBe(String.fromCodePoint(0x1f600 + 29));
  });

  test('bad stored data is ignored', () => {
    localStorage.setItem('disgourd.recentEmoji', '{not json');
    expect(getRecentEmoji()).toEqual([]);
  });
});

test('insertAtCaret puts the emoji where the cursor is and the cursor after it', () => {
  expect(insertAtCaret('hello world', 5, 5, '🔥')).toEqual({ text: 'hello🔥 world', caret: 7 });
  // A selection is replaced.
  expect(insertAtCaret('hello world', 6, 11, '🌍')).toEqual({ text: 'hello 🌍', caret: 8 });
  // No caret known: append.
  expect(insertAtCaret('hi', null, null, '👋')).toEqual({ text: 'hi👋', caret: 4 });
});
