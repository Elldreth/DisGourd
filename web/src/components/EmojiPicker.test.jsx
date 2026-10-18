import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import EmojiPicker from './EmojiPicker.jsx';

beforeEach(() => localStorage.clear());
afterEach(cleanup);

const bare = (e) => e.replace(/️/g, '');

async function open(props = {}) {
  const onPick = vi.fn();
  const onClose = vi.fn();
  render(<EmojiPicker onPick={onPick} onClose={onClose} {...props} />);
  const search = await screen.findByRole('searchbox', { name: 'Search emoji' });
  await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(100));
  return { onPick, onClose, search };
}

test('the search box has focus straight away', async () => {
  const { search } = await open();
  expect(document.activeElement).toBe(search);
});

test('keyboard only: type, Enter picks the top match', async () => {
  const { onPick, search } = await open();
  fireEvent.change(search, { target: { value: 'fire' } });
  fireEvent.keyDown(search, { key: 'Enter' });
  expect(bare(onPick.mock.calls[0][0])).toBe('🔥');
});

test('arrow keys move the highlight through the results', async () => {
  const { onPick, search } = await open();
  fireEvent.change(search, { target: { value: 'thumbs' } }); // 👍 then 👎
  fireEvent.keyDown(search, { key: 'ArrowRight' });
  fireEvent.keyDown(search, { key: 'Enter' });
  expect(bare(onPick.mock.calls[0][0])).toBe('👎');
});

test('Esc closes', async () => {
  const { onClose, search } = await open();
  fireEvent.keyDown(search, { key: 'Escape' });
  expect(onClose).toHaveBeenCalled();
});

test('clicking an emoji picks it, and it shows under Recent next time', async () => {
  const { onPick } = await open();
  fireEvent.click(screen.getByRole('option', { name: 'fire' }));
  expect(bare(onPick.mock.calls[0][0])).toBe('🔥');
  cleanup();
  await open();
  const recent = screen.getByRole('group', { name: 'Recent' });
  expect(recent.textContent).toContain('🔥');
});

test('no matches says so', async () => {
  const { search } = await open();
  fireEvent.change(search, { target: { value: 'zzzzqqq' } });
  expect(screen.getByText(/no emoji found/i)).toBeTruthy();
});

test('a server\'s own emoji get a Server section; picking one gives :name: and its reaction token (P2-19b)', async () => {
  const custom = [{ id: 7, name: 'party_gourd', url: '/uploads/a/party.png' }];
  const { onPick, search } = await open({ custom });
  const group = screen.getByRole('group', { name: 'Server' });
  const option = screen.getByRole('option', { name: ':party_gourd:' });
  expect(group.contains(option)).toBe(true);
  expect(option.querySelector('img').getAttribute('src')).toBe('/uploads/a/party.png');
  fireEvent.click(option);
  expect(onPick).toHaveBeenCalledWith(':party_gourd:', expect.objectContaining({ reaction: '<:party_gourd:7>' }));
  expect(JSON.parse(localStorage.getItem('disgourd.recentEmoji') || '[]')).not.toContain(':party_gourd:');
  fireEvent.change(search, { target: { value: 'party' } });
  await waitFor(() => expect(screen.getByRole('option', { name: ':party_gourd:' })).toBeTruthy());
});
