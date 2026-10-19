// P3-25b: grouping channels by category, the moves, and the layout body.
import { afterEach, expect, test } from 'vitest';
import { buildGroups, layoutBody, loadCollapsed, moveCategory, moveChannel, moveChannelTo, saveCollapsed, visibleWhenCollapsed } from './channelLayout.js';

const categories = [{ id: 1, name: 'Text channels', position: 0 }, { id: 2, name: 'Voice channels', position: 1 }, { id: 3, name: 'Games', position: 2 }];
const meta = {
  general: { type: 'text', category: 1, position: 0 },
  news: { type: 'text', category: 1, position: 1 },
  lounge: { type: 'voice', category: 2, position: 0 },
  rules: { type: 'text', category: null, position: 0 },
};
const groups = () => buildGroups(categories, meta, ['rules', 'general', 'news', 'legacy'], ['lounge']);
const shape = (gs) => gs.map((g) => [g.name ?? '(top)', g.items.map((i) => i.name)]);

afterEach(() => localStorage.clear());

test('groups: the top first, then each category; channels by position; no category info goes to the top', () => {
  expect(shape(groups())).toEqual([['(top)', ['rules', 'legacy']], ['Text channels', ['general', 'news']], ['Voice channels', ['lounge']], ['Games', []]]);
  expect(groups()[2].items[0]).toEqual({ name: 'lounge', type: 'voice' });
  expect(shape(buildGroups([], {}, ['a', 'b'], ['v']))).toEqual([['(top)', ['a', 'b', 'v']]]);
});

test('layout body lists every category and every channel with its category', () => {
  expect(layoutBody(groups())).toEqual({
    categories: [1, 2, 3],
    channels: [
      { name: 'rules', category: null }, { name: 'legacy', category: null },
      { name: 'general', category: 1 }, { name: 'news', category: 1 }, { name: 'lounge', category: 2 },
    ],
  });
});

test('moving a channel up or down swaps within its category, and crosses into the next one at the edge', () => {
  expect(shape(moveChannel(groups(), 'news', -1))[1]).toEqual(['Text channels', ['news', 'general']]);
  const up = shape(moveChannel(groups(), 'general', -1));
  expect(up[0]).toEqual(['(top)', ['rules', 'legacy', 'general']]); // to the end of the group above
  const down = shape(moveChannel(groups(), 'news', 1));
  expect(down[2]).toEqual(['Voice channels', ['news', 'lounge']]); // to the start of the group below
  expect(moveChannel(groups(), 'rules', -1)).toBeNull(); // already first
  expect(moveChannel(groups(), 'nope', 1)).toBeNull();
  expect(shape(groups())[1]).toEqual(['Text channels', ['general', 'news']]); // the original is untouched
});

test('moving a channel to a category puts it at the end; categories move among themselves, never above the top', () => {
  expect(shape(moveChannelTo(groups(), 'rules', 3))[3]).toEqual(['Games', ['rules']]);
  expect(shape(moveChannelTo(groups(), 'general', null))[0]).toEqual(['(top)', ['rules', 'legacy', 'general']]);
  expect(moveChannelTo(groups(), 'general', 1)).toBeNull(); // already there
  expect(shape(moveCategory(groups(), 3, -1)).map((g) => g[0])).toEqual(['(top)', 'Text channels', 'Games', 'Voice channels']);
  expect(moveCategory(groups(), 1, -1)).toBeNull();
  expect(moveCategory(groups(), 3, 1)).toBeNull();
});

test('a collapsed category still shows the channel you are in, ones with mentions, and your voice channel', () => {
  const ctx = { current: 'news', mentions: { general: 2 }, voiceChannel: 'lounge' };
  expect(visibleWhenCollapsed({ name: 'news', type: 'text' }, ctx)).toBe(true);
  expect(visibleWhenCollapsed({ name: 'general', type: 'text' }, ctx)).toBe(true);
  expect(visibleWhenCollapsed({ name: 'quiet', type: 'text' }, ctx)).toBe(false);
  expect(visibleWhenCollapsed({ name: 'lounge', type: 'voice' }, ctx)).toBe(true);
  expect(visibleWhenCollapsed({ name: 'other', type: 'voice' }, ctx)).toBe(false);
});

test('collapsed categories are remembered per server', () => {
  saveCollapsed('S', new Set([1, 3]));
  saveCollapsed('T', new Set([2]));
  expect([...loadCollapsed('S')]).toEqual([1, 3]);
  expect([...loadCollapsed('T')]).toEqual([2]);
  expect([...loadCollapsed('U')]).toEqual([]);
  localStorage.setItem('dg.collapsed', 'not json');
  expect([...loadCollapsed('S')]).toEqual([]);
});
