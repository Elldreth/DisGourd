import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import Avatar from './Avatar.jsx';
import UserFooter from './UserFooter.jsx';
import MemberList from './MemberList.jsx';

afterEach(cleanup);

const dot = (container) => container.querySelector('span.absolute');

test('avatar dots: online lime, idle amber, dnd pink, offline grey', () => {
  const cls = (status) => {
    const { container } = render(<Avatar name="bob" status={status} />);
    const c = dot(container).className;
    cleanup();
    return c;
  };
  expect(cls('online')).toMatch(/bg-online/);
  expect(cls('idle')).toMatch(/bg-idle/);
  expect(cls('dnd')).toMatch(/bg-pink/);
  expect(cls('offline')).toMatch(/bg-gray-500/);
});

test('the footer shows your status and the avatar opens a menu to change it', () => {
  const onSetPresence = vi.fn();
  render(<UserFooter user="sandy" status="open" presence="online" onSetPresence={onSetPresence} onOpenProfile={() => {}} onLogout={() => {}} />);
  expect(screen.getByText('Online')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Set status (Online)' }));
  const menu = screen.getByRole('menu', { name: 'Set status' });
  const items = within(menu).getAllByRole('menuitemradio');
  expect(items.map((i) => i.textContent)).toEqual([
    expect.stringMatching(/^Online/),
    expect.stringMatching(/^Idle/),
    expect.stringMatching(/^Do Not Disturb.*notifications/),
    expect.stringMatching(/^Invisible.*offline/),
  ]);
  expect(items[0].getAttribute('aria-checked')).toBe('true');
  // Each item is named by its words (not just a coloured dot).
  expect(within(menu).getByRole('menuitemradio', { name: /^Do Not Disturb/ })).toBe(items[2]);
  expect(within(menu).getByRole('menuitemradio', { name: /^Invisible/ })).toBe(items[3]);
  expect(document.activeElement).toBe(items[0]); // keyboard lands in the menu
  fireEvent.keyDown(items[0], { key: 'ArrowDown' });
  expect(document.activeElement).toBe(items[1]);
  fireEvent.click(items[2]);
  expect(onSetPresence).toHaveBeenCalledWith('dnd');
  expect(screen.queryByRole('menu')).toBeNull();
});

test('Esc closes the menu and returns focus to the avatar', () => {
  render(<UserFooter user="sandy" status="open" presence="online" onSetPresence={() => {}} onOpenProfile={() => {}} onLogout={() => {}} />);
  const opener = screen.getByRole('button', { name: /Set status/ });
  fireEvent.click(opener);
  fireEvent.keyDown(screen.getAllByRole('menuitemradio')[0], { key: 'Escape' });
  expect(screen.queryByRole('menu')).toBeNull();
  expect(document.activeElement).toBe(opener);
});

test('invisible and dnd are shown as such to you; connection trouble takes precedence', () => {
  const { rerender } = render(<UserFooter user="sandy" status="open" presence="invisible" onSetPresence={() => {}} onOpenProfile={() => {}} onLogout={() => {}} />);
  expect(screen.getByText('Invisible')).toBeTruthy();
  rerender(<UserFooter user="sandy" status="open" presence="dnd" onSetPresence={() => {}} onOpenProfile={() => {}} onLogout={() => {}} />);
  expect(screen.getByText('Do Not Disturb')).toBeTruthy();
  rerender(<UserFooter user="sandy" status="reconnecting" presence="dnd" onSetPresence={() => {}} onOpenProfile={() => {}} onLogout={() => {}} />);
  expect(screen.getByText('Reconnecting…')).toBeTruthy();
});

test('members: idle and dnd count as online, each with its own dot and words', () => {
  const members = [
    { username: 'ann', role: 'owner', status: 'online', online: true },
    { username: 'ben', role: 'member', status: 'dnd', online: true },
    { username: 'cat', role: 'member', status: 'idle', online: true },
    { username: 'dan', role: 'member', status: 'offline', online: false },
  ];
  render(<MemberList space="S" members={members} currentUser="ann" myRole="owner" onMessageUser={() => {}} onSetRole={() => {}} onKick={() => {}} open onClose={() => {}} />);
  expect(screen.getByText('Online — 3')).toBeTruthy();
  expect(screen.getByText('Offline — 1')).toBeTruthy();
  // (the avatar's initials come first in the row's name, e.g. "BE ben, Do Not Disturb")
  const row = (name) => screen.getByRole('button', { name: new RegExp(name) });
  expect(row('ben').textContent).toMatch(/Do Not Disturb/);
  expect(dot(row('ben')).className).toMatch(/bg-pink/);
  expect(row('cat').textContent).toMatch(/Idle/);
  expect(dot(row('cat')).className).toMatch(/bg-idle/);
  expect(dot(row('dan')).className).toMatch(/bg-gray-500/);
});

test('one status dot in the footer: the avatar shows it; the line only adds one for connection trouble', () => {
  const dots = (container) => container.querySelectorAll('.rounded-full.h-2.w-2, span.absolute.rounded-full');
  const { container, rerender } = render(
    <UserFooter user="sandy" status="open" presence="online" onSetPresence={() => {}} onOpenProfile={() => {}} onLogout={() => {}} />
  );
  expect(dots(container)).toHaveLength(1); // just the avatar's
  rerender(<UserFooter user="sandy" status="reconnecting" presence="online" onSetPresence={() => {}} onOpenProfile={() => {}} onLogout={() => {}} />);
  expect(dots(container)).toHaveLength(2); // the avatar's, plus the pulsing connection dot
  expect(screen.getByText('Reconnecting…')).toBeTruthy();
});
