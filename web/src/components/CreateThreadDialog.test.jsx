import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../api.js', () => ({ createThread: vi.fn() }));
const api = await import('../api.js');
const { default: CreateThreadDialog, defaultThreadName } = await import('./CreateThreadDialog.jsx');

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const message = { id: 7, author: 'bob', content: 'Plans for the weekend? Let us discuss the details here' };

test('the name is prefilled from the message (cut to 40 characters) and editable', () => {
  expect(defaultThreadName('short one')).toBe('short one');
  expect(defaultThreadName(message.content)).toBe('Plans for the weekend? Let us discuss t…');
  expect(defaultThreadName('a ||secret|| plan')).toBe('a (spoiler) plan');
  expect(defaultThreadName('')).toBe('');
});

test('Create sends the right request and hands over the new thread', async () => {
  const thread = { id: 3, channel: '~t7', name: 'Weekend plans', rootMessageId: 7, parentChannel: 'general', messageCount: 0 };
  api.createThread.mockResolvedValueOnce({ thread });
  const onCreated = vi.fn();
  render(<CreateThreadDialog space="S" channel="general" message={message} onCreated={onCreated} onClose={() => {}} />);
  const box = screen.getByRole('textbox', { name: 'Thread name' });
  expect(box.value).toBe('Plans for the weekend? Let us discuss t…');
  fireEvent.change(box, { target: { value: '  Weekend plans ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create thread' }));
  await waitFor(() => expect(onCreated).toHaveBeenCalledWith(thread));
  expect(api.createThread).toHaveBeenCalledWith('S', 'general', 7, 'Weekend plans');
});

test('a server error shows and the dialog stays open', async () => {
  api.createThread.mockRejectedValueOnce(new Error('You cannot post in this channel'));
  const onCreated = vi.fn();
  render(<CreateThreadDialog space="S" channel="general" message={message} onCreated={onCreated} onClose={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Create thread' }));
  expect((await screen.findByRole('alert')).textContent).toBe('You cannot post in this channel');
  expect(onCreated).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog', { name: 'Create thread' })).toBeTruthy();
});
