import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import QuickSwitcher, { rankItems, itemKey, loadRecent, recordVisit } from './QuickSwitcher.jsx';

beforeEach(() => localStorage.clear());
afterEach(cleanup);

const ch = (space, channel, extra = {}) => ({ kind: 'channel', space, channel, ...extra });
const items = [
  ch('Alpha', 'general'),
  ch('Alpha', 'gaming-news', { unread: 3 }),
  ch('Beta', 'general', { unread: 1 }),
  ch('Beta', 'random', { mention: 1, unread: 1 }),
  { kind: 'server', name: 'Gentle Folk' },
  { kind: 'dm', username: 'bob' },
];

test('a better match wins; among equal matches unread comes first', () => {
  const ranked = rankItems(items, 'gen', []);
  expect(ranked[0]).toMatchObject({ kind: 'channel', space: 'Beta', channel: 'general' });
  expect(ranked[1]).toMatchObject({ space: 'Alpha', channel: 'general' });
  expect(ranked.map(itemKey)).not.toContain(itemKey(items[3])); // "random" doesn't match "gen"
  expect(rankItems(items, 'gnws', []).map((i) => i.channel)).toEqual(['gaming-news']); // fuzzy, in order
});

test('with no query: mentions, then unread, then recently visited', () => {
  const recent = [itemKey({ kind: 'dm', username: 'bob' })];
  const ranked = rankItems(items, '', recent).map(itemKey);
  expect(ranked.slice(0, 4)).toEqual([
    itemKey(items[3]), // mention
    itemKey(items[1]), // 3 unread
    itemKey(items[2]), // 1 unread
    itemKey(items[5]), // recent
  ]);
});

test('recent visits keep the last 10, newest first, without repeats', () => {
  for (let i = 0; i < 12; i++) recordVisit(`c:${i}`, 'me');
  recordVisit('c:5', 'me');
  const recent = loadRecent('me');
  expect(recent).toHaveLength(10);
  expect(recent[0]).toBe('c:5');
  expect(recent.filter((k) => k === 'c:5')).toHaveLength(1);
  expect(loadRecent('someone-else')).toEqual([]);
});

function setup() {
  const onPick = vi.fn();
  const onClose = vi.fn();
  render(<QuickSwitcher items={items} recent={[]} onPick={onPick} onClose={onClose} />);
  return { onPick, onClose, box: screen.getByRole('combobox', { name: 'Where do you want to go?' }) };
}

test('a dialog with a combobox; type and press Enter to go to the top result', async () => {
  const { onPick, box } = setup();
  expect(screen.getByRole('dialog', { name: 'Quick switcher' })).toBeTruthy();
  await waitFor(() => expect(document.activeElement).toBe(box));
  fireEvent.change(box, { target: { value: 'gen' } });
  const options = screen.getAllByRole('option');
  expect(options[0].textContent).toContain('general');
  expect(options[0].textContent).toContain('Beta');
  expect(box.getAttribute('aria-activedescendant')).toBe(options[0].id);
  fireEvent.keyDown(box, { key: 'Enter' });
  expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ space: 'Beta', channel: 'general' }));
});

test('arrow keys move the highlight (wrapping); clicking a row picks it', () => {
  const { onPick, box } = setup();
  fireEvent.change(box, { target: { value: 'gen' } });
  const options = screen.getAllByRole('option');
  fireEvent.keyDown(box, { key: 'ArrowDown' });
  expect(box.getAttribute('aria-activedescendant')).toBe(options[1].id);
  expect(options[1].getAttribute('aria-selected')).toBe('true');
  fireEvent.keyDown(box, { key: 'ArrowUp' });
  fireEvent.keyDown(box, { key: 'ArrowUp' });
  expect(box.getAttribute('aria-activedescendant')).toBe(options[options.length - 1].id);
  fireEvent.change(box, { target: { value: 'bo' } });
  fireEvent.click(screen.getByRole('option', { name: /bob/ }));
  expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ kind: 'dm', username: 'bob' }));
});

test('says so when nothing matches', () => {
  const { box } = setup();
  fireEvent.change(box, { target: { value: 'zzzz' } });
  expect(screen.queryAllByRole('option')).toHaveLength(0);
  expect(screen.getByText(/No matches/)).toBeTruthy();
});
