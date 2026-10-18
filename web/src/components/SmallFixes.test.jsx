// P3-20b: Create / Join a server from the empty screen, offline members
// readable without opacity, links underlined at rest, and the DM divider.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('../audio.js', async (orig) => ({ ...(await orig()), displayCaptureSupported: () => true }));
const { default: ChatPanel } = await import('./ChatPanel.jsx');
const { default: ServerRail } = await import('./ServerRail.jsx');
const { default: MemberList } = await import('./MemberList.jsx');
const { default: MessageList } = await import('./MessageList.jsx');

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

const panel = (props) =>
  render(
    <ChatPanel space="" channel="" status="open" canPost messages={[]} currentUser="sandy" typingUsers={[]} memberNames={[]}
      onOpenNav={() => {}} onOpenSearch={() => {}} onOpenMembers={() => {}} {...props} />
  );

test('with no servers, the empty screen offers Create a server and Join with an invite', () => {
  const onAddServer = vi.fn();
  panel({ onAddServer });
  expect(screen.getByRole('heading', { name: 'You’re not in any servers yet' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Create a server' }));
  fireEvent.click(screen.getByRole('button', { name: 'Join with an invite' }));
  expect(onAddServer.mock.calls).toEqual([['create'], ['join']]);
  cleanup();
  panel({}); // servers exist, none picked: the old hint, no buttons
  expect(screen.getByRole('heading', { name: 'No server selected' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Create a server' })).toBeNull();
});

test('the rail opens its Add-a-server dialog on request, on the asked tab, each time', () => {
  const rail = (openRequest) => (
    <ServerRail spaces={[]} currentSpace="" unread={{}} onSelect={() => {}} onCreate={() => {}} onJoin={() => {}} onSelectDms={() => {}} openRequest={openRequest} />
  );
  const { rerender } = render(rail(null));
  expect(screen.queryByRole('dialog')).toBeNull();
  rerender(rail({ tab: 'join', n: 1 }));
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(screen.getByRole('tab', { name: /Join/ }).getAttribute('aria-selected')).toBe('true');
});

test('offline members: muted text and a greyed avatar, not opacity', () => {
  const members = [
    { username: 'ann', role: 'owner', status: 'online' },
    { username: 'bob', role: 'member', status: 'offline' },
  ];
  render(<MemberList space="S" members={members} currentUser="ann" myRole="owner" onMessageUser={() => {}} onKick={() => {}} />);
  const bob = screen.getByText('bob');
  expect(bob.className).toContain('text-gray-500');
  expect(bob.closest('button').className).not.toContain('opacity-50');
  expect(bob.closest('button').querySelector('.grayscale')).toBeTruthy();
  expect(screen.getByText('ann').className).toContain('text-gray-200');
});

test('links in messages are underlined at rest', () => {
  const css = readFileSync(resolve('src/index.css'), 'utf8');
  const rule = css.match(/\.md-link \{([^}]*)\}/)[1];
  expect(rule).toMatch(/text-decoration:\s*underline/);
  expect(rule).not.toMatch(/text-decoration:\s*none/);
});

test('a DM shows the "New" divider before the first unread message', () => {
  const msgs = [
    { id: 1, author: 'bob', content: 'old', timestamp: 1700000000000 },
    { id: 2, author: 'bob', content: 'new one', timestamp: 1700000060000 },
  ];
  render(<MessageList messages={msgs} currentUser="sandy" simple newMessages={{ since: 1, count: 1 }} />);
  expect(screen.getByText(/^New$/i)).toBeTruthy();
});
