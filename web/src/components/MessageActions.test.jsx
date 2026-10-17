import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ReactionPicker } from './MessageActions.jsx';

beforeEach(() => localStorage.clear());
afterEach(cleanup);

const bare = (e) => e.replace(/️/g, '');

function setup(props = {}) {
  const onPick = vi.fn();
  const onClose = vi.fn();
  render(<ReactionPicker onPick={onPick} onClose={onClose} {...props} />);
  return { onPick, onClose };
}

async function openFullPicker() {
  fireEvent.click(screen.getByRole('menuitem', { name: 'More reactions' }));
  const search = await screen.findByRole('searchbox', { name: 'Search emoji' });
  await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(100));
  return search;
}

test('the quick reactions are still there, plus a "More reactions" button', () => {
  setup();
  expect(screen.getByRole('menuitem', { name: 'React with 👍' })).toBeTruthy();
  expect(screen.getAllByRole('menuitem')).toHaveLength(9);
});

test('any emoji from the full picker becomes the reaction', async () => {
  const { onPick } = setup();
  const search = await openFullPicker();
  fireEvent.change(search, { target: { value: 'melting' } });
  fireEvent.keyDown(search, { key: 'Enter' });
  expect(onPick).toHaveBeenCalledWith('🫠');
});

test('keyboard only: arrow to "More reactions", Enter, search, Enter', async () => {
  const { onPick } = setup();
  const first = screen.getByRole('menuitem', { name: 'React with 👍' });
  expect(document.activeElement).toBe(first);
  fireEvent.keyDown(first, { key: 'End' });
  const more = screen.getByRole('menuitem', { name: 'More reactions' });
  expect(document.activeElement).toBe(more);
  fireEvent.click(more); // Enter on a button clicks it
  const search = await screen.findByRole('searchbox', { name: 'Search emoji' });
  await waitFor(() => expect(document.activeElement).toBe(search));
  fireEvent.change(search, { target: { value: 'family' } });
  fireEvent.keyDown(search, { key: 'Enter' });
  expect(bare(onPick.mock.calls[0][0])).toMatch(/^👪|👨‍👩‍👦/u);
});

test('Esc in the full picker closes it', async () => {
  const { onClose } = setup();
  const search = await openFullPicker();
  fireEvent.keyDown(search, { key: 'Escape' });
  expect(onClose).toHaveBeenCalled();
});
