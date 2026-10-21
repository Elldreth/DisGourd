// P9-07b: blocking in the app — the block state, the four places to block or
// unblock, collapsed messages, reply quotes, typing, notifications, the
// blocked 1-to-1's bar and the Settings list.
import { afterEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';

vi.mock('../api.js', () => ({
  getBlocks: vi.fn(),
  blockUser: vi.fn(async () => ({ ok: true, blocked: true })),
  unblockUser: vi.fn(async () => ({ ok: true, blocked: false })),
  hideDmPreview: vi.fn(),
  getDmVersions: vi.fn(),
}));
const api = await import('../api.js');
const { useBlocks, BlocksContext } = await import('../state/useBlocks.js');
const { default: MemberList } = await import('./MemberList.jsx');
const { default: MessageList } = await import('./MessageList.jsx');
const { default: TypingIndicator } = await import('./TypingIndicator.jsx');
const { default: DmPanel } = await import('./DmPanel.jsx');
const { default: BlockedSection } = await import('./settings/BlockedSection.jsx');
const { attentionKind } = await import('../notify.js');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
Element.prototype.scrollIntoView = vi.fn();

// A provider with bob blocked (and the actions as spies).
function withBlocks(ui, blocked = ['bob']) {
  const value = {
    list: blocked.map((username, i) => ({ id: i + 1, username, avatar: null, since: 1 })),
    isBlocked: (n) => blocked.includes(n),
    requestBlock: vi.fn(),
    unblock: vi.fn(),
  };
  return { value, ...render(<BlocksContext.Provider value={value}>{ui}</BlocksContext.Provider>) };
}
const T = new Date('2026-10-21T15:00:00').getTime();

test('useBlocks: loads after sign-in; block and unblock call the server and reload; a blocks_changed frame reloads', async () => {
  api.getBlocks.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 2, username: 'bob' }]).mockResolvedValue([]);
  const { result } = renderHook(() => useBlocks({ token: 't' }));
  await waitFor(() => expect(api.getBlocks).toHaveBeenCalledTimes(1));
  expect(result.current.isBlocked('bob')).toBe(false);
  await act(() => result.current.block('bob'));
  expect(api.blockUser).toHaveBeenCalledWith('bob');
  await waitFor(() => expect(result.current.isBlocked('bob')).toBe(true));
  await act(() => result.current.unblock('bob'));
  expect(api.unblockUser).toHaveBeenCalledWith('bob');
  await waitFor(() => expect(result.current.isBlocked('bob')).toBe(false));
  act(() => result.current.handlers.blocks_changed());
  await waitFor(() => expect(api.getBlocks).toHaveBeenCalledTimes(4));
});

test('member list: Block… asks (for someone not blocked), Unblock acts at once; not on yourself', () => {
  const members = [
    { username: 'sandy', online: true, role: 'owner' },
    { username: 'bob', online: true, role: 'member' },
    { username: 'cara', online: true, role: 'member' },
  ];
  const { value } = withBlocks(<MemberList members={members} currentUser="sandy" myRole="member" myPosition={0} onMessageUser={() => {}} onClose={() => {}} />);
  // P10-03: bob (blocked) is marked in the list; Block… is plain, not the moderators' amber.
  expect(within(screen.getByTitle('bob')).getByRole('img', { name: 'Blocked' })).toBeTruthy();
  expect(within(screen.getByTitle('cara')).queryByRole('img', { name: 'Blocked' })).toBeNull();
  fireEvent.click(screen.getByTitle('cara'));
  expect(within(screen.getByRole('group', { name: 'Actions for cara' })).getByRole('button', { name: 'Block…' }).className).not.toMatch(/text-idle/);
  fireEvent.click(within(screen.getByRole('group', { name: 'Actions for cara' })).getByRole('button', { name: 'Block…' }));
  expect(value.requestBlock).toHaveBeenCalledWith('cara');
  fireEvent.click(screen.getByTitle('bob'));
  fireEvent.click(within(screen.getByRole('group', { name: 'Actions for bob' })).getByRole('button', { name: 'Unblock' }));
  expect(value.unblock).toHaveBeenCalledWith('bob');
  expect(screen.queryByTitle('You') && screen.queryByRole('group', { name: 'Actions for sandy' })).toBeFalsy();
});

test('messages: a run of blocked ones is one "Blocked message · Show" row; Show reveals; replies quote "Blocked message"; the menu offers Block', () => {
  const msgs = [
    { id: 1, author: 'bob', content: 'one', timestamp: T },
    { id: 2, author: 'bob', content: 'two', timestamp: T + 1 },
    { id: 3, author: 'cara', content: 'hi', timestamp: T + 2, replyTo: { id: 1, author: 'bob', snippet: 'one' } },
    { id: 4, author: 'bob', content: 'three', timestamp: T + 3 },
  ];
  const { value, container } = withBlocks(<MessageList messages={msgs} channel="general" currentUser="sandy" />);
  expect(screen.queryByText('one')).toBeNull();
  // P10-03: a full row with its own spacing, plain (not italic) words.
  expect(screen.getByText('2 messages from someone you blocked')).toBeTruthy();
  expect(screen.getByText('A message from someone you blocked')).toBeTruthy(); // the single one after cara's
  expect(screen.getAllByText('Blocked message')).toHaveLength(1); // cara's reply quote
  for (const row of container.querySelectorAll('[data-blocked-row]')) {
    expect(row.className).toMatch(/\bmt-3\b/);
    expect(row.className).not.toMatch(/italic/);
  }
  expect(screen.getAllByRole('button', { name: 'Show' })).toHaveLength(2);
  expect(container.querySelector('[data-msg-id="3"]').textContent).toMatch(/@bobBlocked message/); // cara's reply quote
  fireEvent.click(screen.getAllByRole('button', { name: 'Show' })[0]);
  expect(screen.getByText('one')).toBeTruthy();
  expect(screen.getByText('two')).toBeTruthy();
  expect(screen.queryByText('three')).toBeNull(); // still collapsed
  // The menu on cara's message offers Block; on a revealed blocked message it doesn't.
  fireEvent.contextMenu(container.querySelector('[data-msg-id="3"]'));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Block cara…' }));
  expect(value.requestBlock).toHaveBeenCalledWith('cara');
  fireEvent.contextMenu(container.querySelector('[data-msg-id="1"]'));
  expect(screen.queryByRole('menuitem', { name: /^Block/ })).toBeNull();
});

test('typing lines and notifications leave blocked people out', () => {
  withBlocks(<TypingIndicator names={['bob', 'cara']} />);
  expect(screen.getByText('cara is typing…')).toBeTruthy();
  const ctx = { me: 'sandy', focused: false, view: 'server', level: 'all', sounds: true, blocked: (n) => n === 'bob' };
  expect(attentionKind({ kind: 'message', author: 'bob', space: 'S', channel: 'general', mentions: ['sandy'] }, ctx)).toBeNull();
  expect(attentionKind({ kind: 'dm', from: 'bob', conversation: 1 }, ctx)).toBeNull();
  expect(attentionKind({ kind: 'message', author: 'cara', space: 'S', channel: 'general', mentions: ['sandy'] }, ctx)).toBe('mention');
});

test('a 1-to-1: Block in the header’s ⋯ menu; a bar instead of the composer when blocked, either way', () => {
  const base = { messages: [], currentUser: 'sandy', typing: [], onOpenNav: () => {}, onOpenSearch: () => {}, onSend: () => {} };
  // Not blocked: Block in the header's ⋯ menu (P10-03), not a bare icon.
  const first = withBlocks(<DmPanel {...base} conversationKey="c:2" conversation={{ key: 'c:2', kind: 'pair', username: 'cara' }} username="cara" />);
  expect(screen.queryByRole('button', { name: 'Block cara' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'More for cara' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Block cara…' }));
  expect(first.value.requestBlock).toHaveBeenCalledWith('cara');
  expect(screen.getByPlaceholderText('Message @cara')).toBeTruthy();
  cleanup();
  // I blocked bob: the bar with Unblock, no composer, no Block button.
  const mine = withBlocks(<DmPanel {...base} conversationKey="c:1" conversation={{ key: 'c:1', kind: 'pair', username: 'bob', blocked: true }} username="bob" />);
  expect(screen.queryByPlaceholderText('Message @bob')).toBeNull();
  expect(screen.queryByRole('button', { name: 'More for bob' })).toBeNull(); // nothing left in it
  expect(screen.getByRole('status').textContent).toMatch(/You’ve blocked bob\. Unblock to message them\./);
  fireEvent.click(within(screen.getByRole('status')).getByRole('button', { name: 'Unblock' }));
  expect(mine.value.unblock).toHaveBeenCalledWith('bob');
  cleanup();
  // They blocked me (the server says so): the bar, no Unblock.
  withBlocks(<DmPanel {...base} conversationKey="c:3" conversation={{ key: 'c:3', kind: 'pair', username: 'dee', blocked: true }} username="dee" />);
  expect(screen.getByRole('status').textContent).toBe('You can’t message this person.');
  expect(screen.queryByRole('button', { name: 'Unblock' })).toBeNull();
});

test('Settings › Blocked people: the list with Unblock, or a note when empty', () => {
  const { value } = withBlocks(<BlockedSection />, ['bob', 'dee']);
  const list = screen.getByRole('list', { name: 'Blocked people' });
  expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['BObobUnblock', 'DEdeeUnblock']);
  fireEvent.click(within(list).getAllByRole('button', { name: 'Unblock' })[1]);
  expect(value.unblock).toHaveBeenCalledWith('dee');
  cleanup();
  withBlocks(<BlockedSection />, []);
  expect(screen.getByText('You haven’t blocked anyone.')).toBeTruthy();
  expect(document.querySelector('svg[data-art="privacy"]')).toBeTruthy(); // P10-02: the shield mascot
});

test('P10-03: searching New message or the group picker for someone I blocked shows them, greyed, with Unblock', async () => {
  const { default: QuickSwitcher } = await import('./QuickSwitcher.jsx');
  const { default: PeoplePicker } = await import('./PeoplePicker.jsx');
  const onUnblock = vi.fn();
  render(<QuickSwitcher mode="people" items={[{ kind: 'person', username: 'bob' }]} recent={[]} onPick={() => {}} onClose={() => {}} blocked={['dee']} onUnblock={onUnblock} />);
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'de' } });
  const list = screen.getByRole('list', { name: 'People you’ve blocked' });
  expect(list.textContent).toContain('dee· You blocked them');
  expect(screen.queryByText(/No one by that name/)).toBeNull();
  fireEvent.click(within(list).getByRole('button', { name: 'Unblock' }));
  expect(onUnblock).toHaveBeenCalledWith('dee');
  expect(document.activeElement).toBe(screen.getByRole('combobox')); // focus stays in the picker
  cleanup();
  render(<PeoplePicker title="Start a group" people={[{ username: 'bob' }]} blocked={['dee']} onUnblock={onUnblock} onConfirm={() => {}} onClose={() => {}} />);
  expect(screen.queryByRole('list', { name: 'People you’ve blocked' })).toBeNull(); // only when searching
  fireEvent.change(screen.getByLabelText('Find people'), { target: { value: 'dee' } });
  expect(screen.getByRole('list', { name: 'People you’ve blocked' })).toBeTruthy();
  expect(screen.queryByText(/No one by that name/)).toBeNull();
});
