import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const rows = [
  { id: 1, name: 'party_gourd', url: '/uploads/a/party.png', createdBy: 'sandy' },
  { id: 2, name: 'thinking', url: '/uploads/b/think.gif', createdBy: 'bob' },
];
vi.mock('../api.js', () => ({
  getEmoji: vi.fn(async () => rows),
  addEmoji: vi.fn(async () => ({ id: 3 })),
  deleteEmoji: vi.fn(async () => ({ ok: true })),
  uploadFile: vi.fn(async () => ({ url: '/uploads/c/new.png' })),
}));
const api = await import('../api.js');
const { default: ServerEmojiDialog, suggestEmojiName } = await import('./server-settings/EmojiSection.jsx');

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const png = (name, size = 100) => new File([new Uint8Array(size)], name, { type: 'image/png' });

test('a file name suggests the emoji name', () => {
  expect(suggestEmojiName('Party Gourd.PNG')).toBe('party_gourd');
  expect(suggestEmojiName('  --cool--.gif')).toBe('cool');
  expect(suggestEmojiName('x'.repeat(40) + '.png')).toHaveLength(32);
});

test('lists the emoji with who added them, and Delete removes one', async () => {
  const onChanged = vi.fn();
  render(<ServerEmojiDialog space="S" emoji={[]} onClose={() => {}} onChanged={onChanged} />);
  await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2));
  expect(screen.getAllByRole('listitem')[0].textContent).toContain(':party_gourd:');
  expect(screen.getAllByRole('listitem')[0].textContent).toContain('added by sandy');
  fireEvent.click(screen.getByRole('button', { name: 'Delete :thinking:' }));
  await waitFor(() => expect(api.deleteEmoji).toHaveBeenCalledWith('S', 'thinking'));
  await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
  expect(onChanged).toHaveBeenCalled();
});

test('Add uploads the image, then adds it under the (suggested, editable) name', async () => {
  const onChanged = vi.fn();
  render(<ServerEmojiDialog space="S" emoji={[]} onClose={() => {}} onChanged={onChanged} />);
  await screen.findAllByRole('listitem');
  const file = png('Party Gourd.png');
  fireEvent.change(screen.getByLabelText('Emoji image'), { target: { files: [file] } });
  const nameBox = screen.getByRole('textbox', { name: 'Emoji name' });
  expect(nameBox.value).toBe('party_gourd');
  fireEvent.change(nameBox, { target: { value: 'Gourd_Party' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
  await waitFor(() => expect(api.addEmoji).toHaveBeenCalledWith('S', 'gourd_party', '/uploads/c/new.png'));
  expect(api.uploadFile).toHaveBeenCalledWith(file);
  await waitFor(() => expect(onChanged).toHaveBeenCalled());
  expect(nameBox.value).toBe(''); // ready for the next one
});

test('a too-large or wrong-type file, or a server refusal, shows an error', async () => {
  render(<ServerEmojiDialog space="S" emoji={[]} onClose={() => {}} />);
  await screen.findAllByRole('listitem');
  fireEvent.change(screen.getByLabelText('Emoji image'), { target: { files: [png('big.png', 300 * 1024)] } });
  expect(screen.getByRole('alert').textContent).toMatch(/256 KB/);
  fireEvent.change(screen.getByLabelText('Emoji image'), { target: { files: [new File(['x'], 'notes.txt', { type: 'text/plain' })] } });
  expect(screen.getByRole('alert').textContent).toMatch(/PNG, JPG, GIF or WebP/);
  expect(screen.getByRole('button', { name: 'Add' }).disabled).toBe(true);
  api.addEmoji.mockRejectedValueOnce(new Error('That name is already used on this server'));
  fireEvent.change(screen.getByLabelText('Emoji image'), { target: { files: [png('party.png')] } });
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
  expect((await screen.findByText('That name is already used on this server')).tagName).toBe('P');
});
