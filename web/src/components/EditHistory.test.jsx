// P3-27: "(edited)" opens the edit history: the text now, then earlier
// versions newest first; messages edited before history was kept say so.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import MessageList from './MessageList.jsx';

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

const T = new Date('2026-10-19T14:00:00').getTime();
const edited = { id: 7, author: 'bob', content: 'final **text**', timestamp: T, editedAt: T + 120_000 };
const plain = { id: 8, author: 'bob', content: 'never edited', timestamp: T + 1000 };
const history = {
  versions: [
    { content: 'first draft', writtenAt: T },
    { content: 'second draft', writtenAt: T + 60_000 },
  ],
  current: { content: 'final **text**', editedAt: T + 120_000 },
};

function list(props = {}) {
  return render(<MessageList messages={[edited, plain]} channel="general" currentUser="sandy" {...props} />);
}

test('"(edited)" opens the history: Now first, then earlier versions newest first, the original last', async () => {
  const loadVersions = vi.fn(async () => history);
  list({ loadVersions });
  expect(screen.getAllByRole('button', { name: '(edited)' })).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: '(edited)' }));
  expect(loadVersions).toHaveBeenCalledWith(edited);
  const dialog = await screen.findByRole('dialog', { name: 'Edit history — bob' });
  await waitFor(() => expect(within(dialog).getAllByRole('listitem')).toHaveLength(3));
  const items = within(dialog).getAllByRole('listitem');
  expect(items[0].textContent).toContain('Now');
  expect(items[0].querySelector('strong')?.textContent).toBe('text'); // rendered like a message
  expect(items[1].textContent).toContain('second draft');
  expect(items[1].textContent).not.toContain('Original');
  expect(items[2].textContent).toContain('Original');
  expect(items[2].textContent).toContain('first draft');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('a message edited before history was kept says so', async () => {
  list({ loadVersions: vi.fn(async () => ({ versions: [], current: { content: 'final **text**', editedAt: T + 120_000 } })) });
  fireEvent.click(screen.getByRole('button', { name: '(edited)' }));
  expect(await screen.findByText('Earlier versions weren’t kept for this message.')).toBeTruthy();
});

test('it reloads when the message is edited again while open, and shows load errors', async () => {
  const loadVersions = vi.fn(async () => history);
  const { rerender } = list({ loadVersions });
  fireEvent.click(screen.getByRole('button', { name: '(edited)' }));
  await screen.findByRole('dialog');
  rerender(<MessageList messages={[{ ...edited, content: 'newer', editedAt: T + 180_000 }, plain]} channel="general" currentUser="sandy" loadVersions={loadVersions} />);
  await waitFor(() => expect(loadVersions).toHaveBeenCalledTimes(2));
  cleanup();
  list({ loadVersions: vi.fn(async () => { throw new Error('Message not found in this channel'); }) });
  fireEvent.click(screen.getByRole('button', { name: '(edited)' }));
  expect((await screen.findByRole('alert')).textContent).toBe('Message not found in this channel');
});

test('without a loader, "(edited)" stays plain text', () => {
  list();
  expect(screen.queryByRole('button', { name: '(edited)' })).toBeNull();
  expect(screen.getByText('(edited)')).toBeTruthy();
});
