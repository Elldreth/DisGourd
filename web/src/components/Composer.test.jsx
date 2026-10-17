import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createRef } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../api.js', () => ({
  uploadFile: vi.fn(async (file) => ({ url: `/uploads/t/${file.name}`, name: file.name, size: file.size })),
}));
const api = await import('../api.js');
const { default: Composer } = await import('./Composer.jsx');

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const file = (name, type = 'image/png') => new File(['x'], name, { type });
const setup = () => {
  const ref = createRef();
  const onSend = vi.fn();
  render(<Composer ref={ref} channel="general" disabled={false} onSend={onSend} onTyping={() => {}} />);
  return { ref, onSend, box: screen.getByPlaceholderText('Message #general') };
};

test('pasting a screenshot attaches it, named so you can tell what it is', async () => {
  const { box, onSend } = setup();
  const shot = file('', 'image/png'); // clipboard images often have no name
  const paste = new Event('paste', { bubbles: true, cancelable: true });
  paste.clipboardData = { files: [shot], items: [] };
  act(() => box.dispatchEvent(paste));
  expect(paste.defaultPrevented).toBe(true);

  await waitFor(() => expect(api.uploadFile).toHaveBeenCalledTimes(1));
  expect(api.uploadFile.mock.calls[0][0].name).toMatch(/^pasted-image-\d+\.png$/);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Send' }).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  expect(onSend.mock.calls[0][1]).toEqual([expect.stringMatching(/^\/uploads\/t\/pasted-image-/)]);
});

test('pasting text is left alone', () => {
  const { box } = setup();
  const paste = new Event('paste', { bubbles: true, cancelable: true });
  paste.clipboardData = { files: [], items: [] };
  act(() => box.dispatchEvent(paste));
  expect(paste.defaultPrevented).toBe(false);
  expect(api.uploadFile).not.toHaveBeenCalled();
});

test('addFiles (used by drag-and-drop) keeps the 10-file cap and says so', async () => {
  const { ref } = setup();
  const twelve = Array.from({ length: 12 }, (_, i) => file(`f${i}.png`));
  await act(async () => {
    await ref.current.addFiles(twelve);
  });
  expect(api.uploadFile).toHaveBeenCalledTimes(10);
  expect(screen.getByText('Only the first 10 files are attached')).toBeTruthy();
});

test('files keep their own names', async () => {
  const { ref } = setup();
  await act(async () => {
    await ref.current.addFiles([file('cat.png')]);
  });
  expect(api.uploadFile.mock.calls[0][0].name).toBe('cat.png');
});

test('the emoji button opens the picker and puts the emoji at the cursor', async () => {
  const { box } = setup();
  fireEvent.change(box, { target: { value: 'so hot right now' } });
  box.setSelectionRange(6, 6); // after "so hot"
  fireEvent.click(screen.getByRole('button', { name: 'Emoji' }));
  const search = await screen.findByRole('searchbox', { name: 'Search emoji' });
  await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(100));
  fireEvent.change(search, { target: { value: 'fire' } });
  fireEvent.keyDown(search, { key: 'Enter' });

  expect(screen.queryByRole('dialog', { name: 'Emoji picker' })).toBeNull();
  expect(box.value.replace(/️/g, '')).toBe('so hot🔥 right now');
  await waitFor(() => expect(document.activeElement).toBe(box));
  expect(box.selectionStart).toBe(6 + '🔥'.length);
});

test('Esc closes the picker and returns to the message box', async () => {
  const { box } = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Emoji' }));
  const search = await screen.findByRole('searchbox', { name: 'Search emoji' });
  fireEvent.keyDown(search, { key: 'Escape' });
  expect(screen.queryByRole('dialog', { name: 'Emoji picker' })).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(box));
});
