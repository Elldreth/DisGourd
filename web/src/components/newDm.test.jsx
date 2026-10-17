import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import QuickSwitcher, { peopleItems } from './QuickSwitcher.jsx';
import DmSidebar from './DmSidebar.jsx';
import DmPanel from './DmPanel.jsx';
import { matchShortcut } from '../shortcuts.js';

// P4-04: start a DM from the DM view. A "New message" button opens the quick
// switcher in a people-only mode listing everyone you share a server with.

beforeEach(() => {
  localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

test('peopleItems: your conversations first, then members of your servers, never you, no repeats', () => {
  const items = peopleItems({
    me: 'sandy',
    conversations: [{ username: 'bob' }, { username: 'cara' }],
    unread: { cara: 2 },
    members: [
      { username: 'sandy' }, // me
      { username: 'bob' }, // already a conversation
      { username: 'dave' },
      { username: 'dave' }, // in two servers
      { username: 'erin' },
    ],
  });
  expect(items).toEqual([
    { kind: 'dm', username: 'bob', unread: 0 },
    { kind: 'dm', username: 'cara', unread: 2 },
    { kind: 'person', username: 'dave' },
    { kind: 'person', username: 'erin' },
  ]);
});

test('people mode: asks who to message, lists members as such, Enter picks the top match', () => {
  const onPick = vi.fn();
  render(
    <QuickSwitcher
      mode="people"
      items={[{ kind: 'dm', username: 'bob', unread: 0 }, { kind: 'person', username: 'dave' }]}
      recent={[]}
      onPick={onPick}
      onClose={() => {}}
    />
  );
  const box = screen.getByRole('combobox', { name: 'Message who?' });
  expect(screen.getByRole('dialog', { name: 'New message' })).toBeTruthy();
  const rows = screen.getAllByRole('option');
  expect(rows[0].textContent).toContain('direct message');
  expect(rows[1].textContent).toContain('member');
  expect(screen.getByText(/Enter to message/)).toBeTruthy();
  fireEvent.change(box, { target: { value: 'da' } });
  fireEvent.keyDown(box, { key: 'Enter' });
  expect(onPick).toHaveBeenCalledWith({ kind: 'person', username: 'dave' });
});

test('people mode with nothing to show says where people come from', () => {
  render(<QuickSwitcher mode="people" items={[]} recent={[]} onPick={() => {}} onClose={() => {}} />);
  expect(screen.getByText(/No one by that name in your servers/)).toBeTruthy();
});

test('Ctrl+Shift+K opens the people picker', () => {
  const key = (k, mods = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });
  expect(matchShortcut(key('K', { ctrlKey: true, shiftKey: true }))).toBe('people');
  expect(matchShortcut(key('k', { metaKey: true, shiftKey: true }))).toBe('people');
  expect(matchShortcut(key('k', { ctrlKey: true }))).toBe('switcher');
});

test('the DM list has a New message button, also in its empty state', () => {
  const onNewMessage = vi.fn();
  const { rerender } = render(<DmSidebar conversations={[]} user="sandy" status="open" onSelect={() => {}} onNewMessage={onNewMessage} />);
  const buttons = screen.getAllByRole('button', { name: 'New message' });
  expect(buttons).toHaveLength(2); // header icon + the empty-state action
  expect(buttons[0].className).toMatch(/\btap\b/);
  fireEvent.click(buttons[1]);
  expect(onNewMessage).toHaveBeenCalledTimes(1);
  rerender(<DmSidebar conversations={[{ username: 'bob' }]} user="sandy" status="open" onSelect={() => {}} onNewMessage={onNewMessage} />);
  expect(screen.getAllByRole('button', { name: 'New message' })).toHaveLength(1);
});

test('the DM home card offers New message', () => {
  const onNewMessage = vi.fn();
  render(<DmPanel username="" messages={[]} currentUser="sandy" onSend={() => {}} onOpenNav={() => {}} onNewMessage={onNewMessage} />);
  fireEvent.click(screen.getByRole('button', { name: 'New message' }));
  expect(onNewMessage).toHaveBeenCalledTimes(1);
});
