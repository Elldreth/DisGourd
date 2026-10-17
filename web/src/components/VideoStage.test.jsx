import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import VideoStage from './VideoStage.jsx';

afterEach(() => {
  cleanup();
  delete document.fullscreenElement;
});

const tile = (key, label, extra = {}) => ({ key, label, userId: key, stream: { id: key }, kind: 'camera', ...extra });
const videos = [
  tile('a', 'You', { self: true, mirror: true }),
  tile('b', 'bob', { speaking: true }),
  tile('c', 'bob — screen', { kind: 'screen' }),
];
const tileEl = (name) => screen.getByRole('group', { name });

test('nothing to show without videos', () => {
  const { container } = render(<VideoStage videos={[]} />);
  expect(container.innerHTML).toBe('');
});

test('a speaking person gets a lit ring, and screen readers hear it', () => {
  render(<VideoStage videos={videos} />);
  const bob = tileEl('bob, speaking');
  expect(bob.className).toMatch(/ring-online/);
  expect(tileEl('You').className).not.toMatch(/ring-online/);
});

test('pinning spotlights a tile; pinning again (or clicking it) restores the grid', () => {
  render(<VideoStage videos={videos} />);
  const pin = screen.getByRole('button', { name: 'Pin bob — screen' });
  expect(pin.getAttribute('aria-pressed')).toBe('false');
  const video = tileEl('bob — screen').querySelector('video');
  fireEvent.click(pin);
  expect(tileEl('bob — screen').querySelector('video')).toBe(video); // restyled, not remounted
  expect(pin.getAttribute('aria-pressed')).toBe('true');
  expect(tileEl('bob — screen').dataset.spotlight).toBe('true');
  expect(tileEl('You').dataset.spotlight).toBe('false');
  fireEvent.click(pin);
  expect(tileEl('bob — screen').dataset.spotlight).toBeUndefined();

  fireEvent.click(tileEl('You')); // clicking the tile itself pins it too
  expect(tileEl('You').dataset.spotlight).toBe('true');
  fireEvent.click(tileEl('You'));
  expect(tileEl('You').dataset.spotlight).toBeUndefined();
});

test('a pinned tile that goes away (share stopped) unpins, and does not come back pinned', () => {
  const { rerender } = render(<VideoStage videos={videos} />);
  fireEvent.click(screen.getByRole('button', { name: 'Pin bob — screen' }));
  rerender(<VideoStage videos={videos.slice(0, 2)} />);
  expect(tileEl('You').dataset.spotlight).toBeUndefined();
  rerender(<VideoStage videos={videos} />);
  expect(tileEl('bob — screen').dataset.spotlight).toBeUndefined();
});

test('full screen puts the tile itself full screen, and the same button leaves it', () => {
  render(<VideoStage videos={videos} />);
  const el = tileEl('bob — screen');
  el.requestFullscreen = vi.fn(async () => {});
  document.exitFullscreen = vi.fn(async () => {});
  const btn = screen.getByRole('button', { name: 'Full screen: bob — screen' });
  fireEvent.click(btn);
  expect(el.requestFullscreen).toHaveBeenCalled();
  expect(el.dataset.spotlight).toBeUndefined(); // the button doesn't also pin

  document.fullscreenElement = el;
  fireEvent(document, new Event('fullscreenchange'));
  const exit = screen.getByRole('button', { name: 'Exit full screen' });
  fireEvent.click(exit);
  expect(document.exitFullscreen).toHaveBeenCalled();
});

test('screen shares are never cropped', () => {
  render(<VideoStage videos={videos} />);
  expect(tileEl('bob — screen').querySelector('video').className).toMatch(/object-contain/);
});
