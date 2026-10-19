// P3-25b: grouping channels by category, the moves, and the layout body.
import { afterEach, expect, test } from 'vitest';
import { buildGroups, categoryDropIndex, channelDropTarget, dropCategory, dropChannel, layoutBody, loadCollapsed, moveCategory, moveChannel, moveChannelTo, saveCollapsed, visibleWhenCollapsed } from './channelLayout.js';

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

// P3-25c: drag and drop.
test('dropping a channel: within its category (indices as shown), into another, or to the top; no-op drops return null', () => {
  expect(shape(dropChannel(groups(), 'general', 1, 2))[1]).toEqual(['Text channels', ['news', 'general']]); // below news
  expect(dropChannel(groups(), 'general', 1, 0)).toBeNull(); // where it already is
  expect(dropChannel(groups(), 'general', 1, 1)).toBeNull(); // just below itself is the same place
  expect(shape(dropChannel(groups(), 'news', 3, 0))[3]).toEqual(['Games', ['news']]); // into an empty category
  expect(shape(dropChannel(groups(), 'lounge', null, 1))[0]).toEqual(['(top)', ['rules', 'lounge', 'legacy']]);
  expect(shape(dropChannel(groups(), 'news', 2, 99))[2]).toEqual(['Voice channels', ['lounge', 'news']]); // clamped to the end
  expect(dropChannel(groups(), 'ghost', 1, 0)).toBeNull();
});

test('dropping a category before another; never above the top group', () => {
  expect(shape(dropCategory(groups(), 3, 1)).map((g) => g[0])).toEqual(['(top)', 'Games', 'Text channels', 'Voice channels']);
  expect(shape(dropCategory(groups(), 1, 4)).map((g) => g[0])).toEqual(['(top)', 'Voice channels', 'Games', 'Text channels']);
  expect(dropCategory(groups(), 1, 0)).toBeNull(); // clamped to the first category place, where it already is
  expect(dropCategory(groups(), 1, 1)).toBeNull();
  expect(dropCategory(groups(), 2, 3)).toBeNull(); // right after itself
});

test('where a drop lands from the pointer’s height', () => {
  const gs = groups();
  // rows of 20 px: top group rules (0–20), legacy (20–40); heading Text (40–60); general (60–80), news (80–100); heading Voice (100–120); lounge (120–140)
  const targets = [
    { kind: 'row', group: null, index: 0, top: 0, bottom: 20 }, { kind: 'row', group: null, index: 1, top: 20, bottom: 40 },
    { kind: 'heading', group: 1, index: 0, top: 40, bottom: 60 },
    { kind: 'row', group: 1, index: 0, top: 60, bottom: 80 }, { kind: 'row', group: 1, index: 1, top: 80, bottom: 100 },
    { kind: 'heading', group: 2, index: 0, top: 100, bottom: 120 },
    { kind: 'row', group: 2, index: 0, top: 120, bottom: 140 },
  ];
  expect(channelDropTarget(targets, 5, gs)).toEqual({ group: null, index: 0 }); // upper half of rules
  expect(channelDropTarget(targets, 15, gs)).toEqual({ group: null, index: 1 }); // lower half
  expect(channelDropTarget(targets, 45, gs)).toEqual({ group: null, index: 2 }); // upper half of a heading: end of the group above
  expect(channelDropTarget(targets, 55, gs)).toEqual({ group: 1, index: 0 }); // lower half: start of that category
  expect(channelDropTarget(targets, 95, gs)).toEqual({ group: 1, index: 2 });
  expect(channelDropTarget(targets, 500, gs)).toEqual({ group: 3, index: 0 }); // below everything: end of the last group
  const sections = [{ index: 1, top: 40, bottom: 100 }, { index: 2, top: 100, bottom: 140 }, { index: 3, top: 140, bottom: 160 }];
  expect(categoryDropIndex(sections, 50, 4)).toBe(1);
  expect(categoryDropIndex(sections, 90, 4)).toBe(2);
  expect(categoryDropIndex(sections, 999, 4)).toBe(4);
});

