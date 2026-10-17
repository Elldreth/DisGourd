import { afterEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useFileDrop } from './useFileDrop.js';

afterEach(cleanup);

function Zone({ enabled = true, onFiles }) {
  const { dragging, dropProps } = useFileDrop({ enabled, onFiles });
  return (
    <main data-testid="zone" {...dropProps}>
      <p data-testid="child">messages</p>
      {dragging && <div>Drop to upload</div>}
    </main>
  );
}

const files = (n) => Array.from({ length: n }, (_, i) => new File(['x'], `f${i}.png`));
const dt = (types, list = []) => ({ dataTransfer: { types, files: list, dropEffect: '' } });

test('dragging files over shows the overlay, and dropping hands them over', () => {
  const onFiles = vi.fn();
  render(<Zone onFiles={onFiles} />);
  const zone = screen.getByTestId('zone');
  fireEvent.dragEnter(zone, dt(['Files']));
  expect(screen.getByText('Drop to upload')).toBeTruthy();
  const three = files(3);
  fireEvent.drop(zone, dt(['Files'], three));
  expect(onFiles).toHaveBeenCalledWith(three);
  expect(screen.queryByText('Drop to upload')).toBeNull();
});

test('moving over child elements does not flicker the overlay', () => {
  render(<Zone onFiles={() => {}} />);
  const zone = screen.getByTestId('zone');
  const child = screen.getByTestId('child');
  fireEvent.dragEnter(zone, dt(['Files']));
  fireEvent.dragEnter(child, dt(['Files'])); // entering a child…
  fireEvent.dragLeave(zone, dt(['Files'])); // …fires leave on the parent
  expect(screen.getByText('Drop to upload')).toBeTruthy();
  fireEvent.dragLeave(child, dt(['Files']));
  expect(screen.queryByText('Drop to upload')).toBeNull();
});

test('ignores drags that are not files (like reordering server icons)', () => {
  const onFiles = vi.fn();
  render(<Zone onFiles={onFiles} />);
  const zone = screen.getByTestId('zone');
  fireEvent.dragEnter(zone, dt(['text/plain']));
  expect(screen.queryByText('Drop to upload')).toBeNull();
  fireEvent.drop(zone, dt(['text/plain']));
  expect(onFiles).not.toHaveBeenCalled();
});

test('does nothing when you cannot post', () => {
  const onFiles = vi.fn();
  render(<Zone enabled={false} onFiles={onFiles} />);
  const zone = screen.getByTestId('zone');
  fireEvent.dragEnter(zone, dt(['Files']));
  expect(screen.queryByText('Drop to upload')).toBeNull();
  fireEvent.drop(zone, dt(['Files'], files(1)));
  expect(onFiles).not.toHaveBeenCalled();
});

test('leaving the window mid-drag (or Esc) clears the overlay', () => {
  render(<Zone onFiles={() => {}} />);
  fireEvent.dragEnter(screen.getByTestId('zone'), dt(['Files']));
  act(() => window.dispatchEvent(new Event('dragend')));
  expect(screen.queryByText('Drop to upload')).toBeNull();
});

test('a file dropped just outside the panel does not make the browser open it', () => {
  render(<Zone onFiles={() => {}} />);
  const over = new Event('dragover', { cancelable: true });
  over.dataTransfer = { types: ['Files'] };
  const drop = new Event('drop', { cancelable: true });
  drop.dataTransfer = { types: ['Files'] };
  window.dispatchEvent(over);
  window.dispatchEvent(drop);
  expect(over.defaultPrevented).toBe(true);
  expect(drop.defaultPrevented).toBe(true);
  // Other drags (text into an input, say) are left alone.
  const text = new Event('drop', { cancelable: true });
  text.dataTransfer = { types: ['text/plain'] };
  window.dispatchEvent(text);
  expect(text.defaultPrevented).toBe(false);
});
