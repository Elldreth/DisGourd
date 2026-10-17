import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import Lightbox from './Lightbox.jsx';

afterEach(cleanup);

const items = ['/uploads/a/one.png', '/uploads/b/two.png', '/uploads/c/three.png'];

function setup(index = 0) {
  const onClose = vi.fn();
  const onIndex = vi.fn();
  render(<Lightbox items={items} index={index} onClose={onClose} onIndex={onIndex} />);
  return { onClose, onIndex };
}

test('is a dialog named for what it shows, with labelled buttons and focus inside', async () => {
  setup(1);
  const dialog = screen.getByRole('dialog', { name: 'Image 2 of 3: two.png' });
  expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Previous image' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Next image' })).toBeTruthy();
  await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
});

test('arrow keys still move between images; Esc closes once', () => {
  const { onClose, onIndex } = setup(0);
  const close = screen.getByRole('button', { name: 'Close' });
  fireEvent.keyDown(close, { key: 'ArrowRight' });
  expect(onIndex).toHaveBeenLastCalledWith(1);
  fireEvent.keyDown(close, { key: 'ArrowLeft' });
  expect(onIndex).toHaveBeenLastCalledWith(2);
  fireEvent.keyDown(close, { key: 'Escape' });
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('clicking around the image closes; clicking the image does not', () => {
  const { onClose } = setup(0);
  fireEvent.click(screen.getByAltText('one.png'));
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('dialog'));
  expect(onClose).toHaveBeenCalledTimes(1);
});
