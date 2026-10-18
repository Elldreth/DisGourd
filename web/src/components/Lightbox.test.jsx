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

// P3-30: right-click and presses stay in the viewer; its size; Download and Open original.
test('right-clicking the viewer image opens the browser menu, not the message menu behind it', async () => {
  Element.prototype.scrollIntoView = vi.fn();
  const MessageList = (await import('./MessageList.jsx')).default;
  const msg = { id: 1, author: 'sandy', content: 'look', attachments: ['/uploads/a/one.png'], timestamp: 1700000000000, reactions: [] };
  render(<MessageList messages={[msg]} channel="general" currentUser="sandy" onReply={() => {}} onDelete={() => {}} onEdit={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: /one\.png|Open/i }));
  const big = await screen.findByRole('dialog', { name: /one\.png/ });
  const img = big.querySelector('img');
  const notPrevented = fireEvent.contextMenu(img);
  expect(notPrevented).toBe(true); // the browser's own menu (Save image as…) opens
  expect(screen.queryByRole('menu')).toBeNull(); // and the message menu doesn't
  // Right-clicking the message itself still opens its menu.
  fireEvent.keyDown(document.activeElement, { key: 'Escape' });
  expect(fireEvent.contextMenu(screen.getByRole('article'))).toBe(false);
});

test('shows the image size once loaded, with Download and Open original', () => {
  setup(0);
  const img = screen.getByAltText('one.png');
  expect(screen.queryByLabelText(/by .* pixels/)).toBeNull();
  Object.defineProperty(img, 'naturalWidth', { value: 2048 });
  Object.defineProperty(img, 'naturalHeight', { value: 1536 });
  fireEvent.load(img);
  expect(screen.getByLabelText('2048 by 1536 pixels').textContent).toBe('2048 × 1536');
  const download = screen.getByRole('link', { name: /Download/ });
  expect(download.getAttribute('href')).toBe('/uploads/a/one.png');
  expect(download.getAttribute('download')).toBe('one.png');
  const open = screen.getByRole('link', { name: /Open original/ });
  expect(open.getAttribute('target')).toBe('_blank');
  expect(open.getAttribute('rel')).toMatch(/noopener/);
});

