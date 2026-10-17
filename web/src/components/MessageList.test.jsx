import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createRef } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

describe('editing your last message from the composer (startEditLast)', () => {
  const own = (id, content) => ({ id, author: 'sandy', content, timestamp: T + id * 1000 });

  function setup(messages) {
    const ref = createRef();
    const onEdit = vi.fn();
    const onEditDone = vi.fn();
    render(<MessageList ref={ref} messages={messages} channel="general" currentUser="sandy" onEdit={onEdit} onEditDone={onEditDone} />);
    return { ref, onEdit, onEditDone };
  }

  test('opens your newest message for editing, caret at the end; Enter saves and hands focus back', async () => {
    const { ref, onEdit, onEditDone } = setup([own(1, 'first'), own(2, 'my latest'), msg(3)]);
    let started;
    act(() => {
      started = ref.current.startEditLast();
    });
    expect(started).toBe(true);
    const box = screen.getByRole('textbox', { name: 'Edit message' });
    expect(box.value).toBe('my latest');
    await waitFor(() => expect(document.activeElement).toBe(box));
    expect(box.selectionStart).toBe('my latest'.length);
    fireEvent.change(box, { target: { value: 'my latest, edited' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onEdit).toHaveBeenCalledWith(2, 'my latest, edited');
    expect(onEditDone).toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: 'Edit message' })).toBeNull();
  });

  test('Esc cancels and also hands focus back', () => {
    const { ref, onEdit, onEditDone } = setup([own(1, 'hello')]);
    act(() => {
      ref.current.startEditLast();
    });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Edit message' }), { key: 'Escape' });
    expect(onEdit).not.toHaveBeenCalled();
    expect(onEditDone).toHaveBeenCalled();
  });

  test('skips your attachment-only messages (nothing to edit there)', () => {
    const photo = { id: 3, author: 'sandy', content: '', attachments: ['/uploads/x/cat.png'], timestamp: T + 3000 };
    const { ref } = setup([own(1, 'has words'), msg(2), photo]);
    act(() => {
      ref.current.startEditLast();
    });
    expect(screen.getByRole('textbox', { name: 'Edit message' }).value).toBe('has words');
  });

  test('with none of your own messages loaded, nothing happens', () => {
    const { ref } = setup([msg(1), msg(2)]);
    let started;
    act(() => {
      started = ref.current.startEditLast();
    });
    expect(started).toBe(false);
    expect(screen.queryByRole('textbox', { name: 'Edit message' })).toBeNull();
  });
});
