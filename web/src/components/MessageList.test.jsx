import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import MessageList from './MessageList.jsx';

// jsdom has no layout: every element measures 0, so a loaded divider counts as
// "in view" and the jump bar only appears when the divider isn't loaded.
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

const T = new Date('2026-10-16T14:00:00').getTime();
const msg = (id, author = 'bob') => ({ id, author, content: `message ${id}`, timestamp: T + id * 1000 });

test('draws the New divider before the first message after where you stopped', () => {
  render(
    <MessageList
      messages={[msg(1), msg(2), msg(3), msg(4)]}
      channel="general"
      currentUser="sandy"
      newMessages={{ since: 2, count: 2 }}
    />
  );
  const sep = screen.getByRole('separator', { name: 'New messages' });
  const rows = screen.getAllByRole('article');
  // The divider sits right before "message 3".
  expect(sep.nextElementSibling).toBe(rows[2]);
  expect(screen.queryByRole('button', { name: 'Jump' })).toBeNull();
});

test('no divider without newMessages, or when only your own messages are new', () => {
  const { rerender } = render(<MessageList messages={[msg(1), msg(2)]} channel="general" currentUser="sandy" />);
  expect(screen.queryByRole('separator', { name: 'New messages' })).toBeNull();
  rerender(
    <MessageList
      messages={[msg(1), msg(2, 'sandy')]}
      channel="general"
      currentUser="sandy"
      newMessages={{ since: 1, count: 1 }}
    />
  );
  expect(screen.queryByRole('separator', { name: 'New messages' })).toBeNull();
});

test('when the first new message is further back, the bar offers Jump and pages back to it', async () => {
  let messages = [msg(60), msg(61)];
  let hasMore = true;
  const view = (props = {}) => (
    <MessageList
      messages={messages}
      channel="general"
      currentUser="sandy"
      hasMore={hasMore}
      onLoadOlder={onLoadOlder}
      newMessages={{ since: 50, count: 11 }}
      {...props}
    />
  );
  // Each "page" adds older messages; the second one reaches back past id 50.
  const onLoadOlder = vi.fn(async () => {
    const oldest = messages[0].id;
    const older = [];
    for (let id = Math.max(45, oldest - 6); id < oldest; id++) older.push(msg(id));
    messages = [...older, ...messages];
    hasMore = messages[0].id > 45;
    rerender(view());
  });
  vi.stubGlobal('requestAnimationFrame', (cb) => setTimeout(cb, 0));
  const { rerender } = render(view());

  expect(screen.getByText('11 new messages')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Jump' }));
  const sep = await waitFor(() => screen.getByRole('separator', { name: 'New messages' }));
  await waitFor(() => expect(sep.scrollIntoView).toHaveBeenCalled());
  expect(onLoadOlder).toHaveBeenCalledTimes(2);
  expect(sep.nextElementSibling.getAttribute('data-msg-id')).toBe('51');
  vi.unstubAllGlobals();
});

test('Mark as read and Esc hide the bar', () => {
  const props = {
    messages: [msg(60), msg(61)],
    channel: 'general',
    currentUser: 'sandy',
    hasMore: true,
    onLoadOlder: () => {},
  };
  const { unmount } = render(<MessageList {...props} newMessages={{ since: 50, count: 11 }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Mark as read' }));
  expect(screen.queryByRole('button', { name: 'Jump' })).toBeNull();
  unmount();

  render(<MessageList {...props} newMessages={{ since: 50, count: 11 }} />);
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('button', { name: 'Jump' })).toBeNull();
});

test('gives up after 10 pages and says so', async () => {
  vi.stubGlobal('requestAnimationFrame', (cb) => setTimeout(cb, 0));
  const onLoadOlder = vi.fn(async () => {}); // never reaches the divider
  render(
    <MessageList
      messages={[msg(600), msg(601)]}
      channel="general"
      currentUser="sandy"
      hasMore
      onLoadOlder={onLoadOlder}
      newMessages={{ since: 1, count: 600 }}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Jump' }));
  await waitFor(() => expect(screen.getByText(/too far back/i)).toBeTruthy());
  expect(onLoadOlder).toHaveBeenCalledTimes(10);
  vi.unstubAllGlobals();
});
