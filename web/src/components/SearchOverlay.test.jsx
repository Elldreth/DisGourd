import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../api.js', () => ({
  search: vi.fn(async () => ({
    channels: [
      { id: 1, author: 'bob', content: 'hello there', space: 'S', channel: 'general', timestamp: 1 },
      { id: 2, author: 'cara', content: 'hello again', space: 'S', channel: 'random', timestamp: 2 },
    ],
    dms: [{ id: 3, author: 'bob', content: 'hello in a DM', dmWith: 'bob', timestamp: 3 }],
  })),
}));
const { default: SearchOverlay } = await import('./SearchOverlay.jsx');

afterEach(cleanup);

function setup() {
  const onOpenChannel = vi.fn();
  const onOpenDm = vi.fn();
  const onClose = vi.fn();
  render(<SearchOverlay onClose={onClose} onOpenChannel={onOpenChannel} onOpenDm={onOpenDm} />);
  return { onOpenChannel, onOpenDm, onClose, box: screen.getByRole('combobox', { name: 'Search messages' }) };
}

test('is a dialog with a combobox that has focus on open', async () => {
  const { box } = setup();
  expect(screen.getByRole('dialog', { name: 'Search messages' })).toBeTruthy();
  await waitFor(() => expect(document.activeElement).toBe(box));
});

test('keyboard only: type, ArrowDown, Enter opens the result', async () => {
  const { box, onOpenChannel, onOpenDm } = setup();
  fireEvent.change(box, { target: { value: 'hello' } });
  const options = await screen.findAllByRole('option', {}, { timeout: 2000 });
  expect(options).toHaveLength(3);
  expect(box.getAttribute('aria-expanded')).toBe('true');
  fireEvent.keyDown(box, { key: 'ArrowDown' });
  expect(box.getAttribute('aria-activedescendant')).toBe(options[0].id);
  expect(options[0].getAttribute('aria-selected')).toBe('true');
  fireEvent.keyDown(box, { key: 'ArrowDown' });
  fireEvent.keyDown(box, { key: 'ArrowDown' }); // the DM result
  fireEvent.keyDown(box, { key: 'ArrowDown' }); // stays on the last one
  fireEvent.keyDown(box, { key: 'Enter' });
  expect(onOpenDm).toHaveBeenCalledWith('bob');
  fireEvent.keyDown(box, { key: 'ArrowUp' });
  fireEvent.keyDown(box, { key: 'Enter' });
  expect(onOpenChannel).toHaveBeenCalledWith('S', 'random');
});

test('Enter with nothing highlighted does nothing; Esc closes once', async () => {
  const { box, onOpenChannel, onClose } = setup();
  fireEvent.change(box, { target: { value: 'hello' } });
  await screen.findAllByRole('option', {}, { timeout: 2000 });
  fireEvent.keyDown(box, { key: 'Enter' });
  expect(onOpenChannel).not.toHaveBeenCalled();
  fireEvent.keyDown(box, { key: 'Escape' });
  expect(onClose).toHaveBeenCalledTimes(1);
});
