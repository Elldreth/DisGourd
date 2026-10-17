import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../api.js', () => ({ getMessages: vi.fn() }));
const api = await import('../api.js');
const { default: ThreadPanel } = await import('./ThreadPanel.jsx');

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = () => {};
});
afterEach(cleanup);

const T = new Date('2026-10-16T14:00:00').getTime();
const root = { id: 7, author: 'bob', content: 'Plans for the **weekend**?', timestamp: T };
const thread = { space: 'S', parentChannel: 'general', channel: '~t7', name: 'Weekend plans', rootMessageId: 7, root };
const replies = [{ id: 8, author: 'cara', content: 'Hiking!', timestamp: T + 1000 }];

function setup(props = {}) {
  const onSend = vi.fn();
  const onClose = vi.fn();
  render(
    <ThreadPanel space="S" thread={thread} status="open" messages={replies} currentUser="sandy" onSend={onSend} onClose={onClose} {...props} />
  );
  return { onSend, onClose };
}

test('shows the root message, the replies and a composer for the thread', () => {
  setup();
  const panel = screen.getByRole('complementary', { name: 'Thread: Weekend plans' });
  expect(panel.textContent).toContain('#general');
  expect(screen.getByText('weekend').tagName).toBe('STRONG'); // the root, rendered as markdown
  expect(screen.getByRole('log', { name: 'Replies in thread Weekend plans' })).toBeTruthy();
  expect(screen.getByText('Hiking!')).toBeTruthy();
  expect(api.getMessages).not.toHaveBeenCalled(); // the root was at hand
});

test('replies are sent from the thread composer; Esc and the close button close it', () => {
  const { onSend, onClose } = setup();
  const box = screen.getByPlaceholderText('Reply in Weekend plans');
  fireEvent.change(box, { target: { value: 'count me in' } });
  fireEvent.keyDown(box, { key: 'Enter' });
  expect(onSend).toHaveBeenCalledWith('count me in', [], false, undefined);
  fireEvent.keyDown(box, { key: 'Escape' });
  expect(onClose).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Close thread' }));
  expect(onClose).toHaveBeenCalledTimes(2);
});

test('without the root at hand it is fetched from the parent channel; a missing one is said to be deleted', async () => {
  api.getMessages.mockResolvedValueOnce([{ id: 6 }, root, { id: 8 }]);
  const { rerender } = render(
    <ThreadPanel space="S" thread={{ ...thread, root: undefined }} status="open" messages={[]} currentUser="sandy" onSend={() => {}} onClose={() => {}} />
  );
  expect(screen.getByText(/Loading the original/)).toBeTruthy();
  await waitFor(() => expect(screen.getByText('weekend')).toBeTruthy());
  expect(api.getMessages).toHaveBeenCalledWith('S', 'general', { around: 7 });
  expect(screen.getByText('No replies yet')).toBeTruthy();

  api.getMessages.mockRejectedValueOnce(new Error('Message not found in this channel'));
  rerender(
    <ThreadPanel space="S" thread={{ ...thread, channel: '~t9', rootMessageId: 9, root: undefined }} status="open" messages={[]} currentUser="sandy" onSend={() => {}} onClose={() => {}} />
  );
  await waitFor(() => expect(screen.getByText('Original message was deleted')).toBeTruthy());
});

test('without permission to post there is no composer', () => {
  setup({ canPost: false });
  expect(screen.queryByPlaceholderText('Reply in Weekend plans')).toBeNull();
  expect(screen.getByText(/permission to post/)).toBeTruthy();
});

test('Follow / Following toggles following the thread (P2-22c)', () => {
  const onToggleFollow = vi.fn();
  const { rerender } = render(
    <ThreadPanel space="S" thread={thread} status="open" messages={[]} currentUser="sandy" onSend={() => {}} onClose={() => {}} followed={false} onToggleFollow={onToggleFollow} />
  );
  const btn = screen.getByRole('button', { name: 'Follow thread' });
  expect(btn.getAttribute('aria-pressed')).toBe('false');
  fireEvent.click(btn);
  expect(onToggleFollow).toHaveBeenCalledWith(true);
  rerender(
    <ThreadPanel space="S" thread={thread} status="open" messages={[]} currentUser="sandy" onSend={() => {}} onClose={() => {}} followed onToggleFollow={onToggleFollow} />
  );
  const on = screen.getByRole('button', { name: 'Unfollow thread' });
  expect(on.textContent).toBe('Following');
  fireEvent.click(on);
  expect(onToggleFollow).toHaveBeenLastCalledWith(false);
});
