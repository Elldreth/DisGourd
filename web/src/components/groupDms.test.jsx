// P9-06d: group DMs in the app — the picker, the members dialog, sidebar
// rows, the header, notices in the list, titles, mute in notifications.
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import PeoplePicker from './PeoplePicker.jsx';
import GroupMembersDialog from './GroupMembersDialog.jsx';
import DmSidebar from './DmSidebar.jsx';
import DmPanel from './DmPanel.jsx';
import MessageList from './MessageList.jsx';
import { conversationTitle } from '../state/useDms.js';
import { attentionKind } from '../notify.js';

afterEach(cleanup);
Element.prototype.scrollIntoView = vi.fn();

const members = [
  { id: 1, username: 'sandy' }, { id: 2, username: 'bob' }, { id: 3, username: 'cara' }, { id: 4, username: 'dee' },
];
const group = { key: 'c:5', id: 5, kind: 'group', name: null, ownerId: 1, muted: false, members };

test('a group’s title: its name, else the others’ names; a pair’s is the other person', () => {
  expect(conversationTitle(group, 'sandy')).toBe('bob, cara and dee');
  expect(conversationTitle({ ...group, members: members.slice(0, 3) }, 'sandy')).toBe('bob and cara');
  expect(conversationTitle({ ...group, name: 'Gourd Club' }, 'sandy')).toBe('Gourd Club');
  expect(conversationTitle({ ...group, members: [members[0]] }, 'sandy')).toBe('Just you');
  expect(conversationTitle({ key: 'c:1', kind: 'pair', username: 'bob' }, 'sandy')).toBe('bob');
});

test('PeoplePicker: search, pick, a locked person, the minimum and maximum, the name, and what it sends', () => {
  const onConfirm = vi.fn();
  render(
    <PeoplePicker
      title="Start a group with bob"
      people={['bob', 'cara', 'dee', 'eve'].map((username) => ({ username }))}
      locked={['bob']}
      min={2}
      max={3}
      withName
      note="This starts a new group. Your messages with bob stay private."
      confirmLabel={(n) => `Start a group (${n + 1} people)`}
      onConfirm={onConfirm}
      onClose={() => {}}
    />
  );
  expect(screen.getByRole('dialog', { name: 'Start a group with bob' })).toBeTruthy();
  expect(screen.getByText('This starts a new group. Your messages with bob stay private.')).toBeTruthy();
  const start = screen.getByRole('button', { name: 'Start a group (2 people)' });
  expect(start.disabled).toBe(true); // bob alone isn't enough
  expect(screen.getByRole('checkbox', { name: 'bob' }).disabled).toBe(true); // locked in
  expect(screen.queryByRole('button', { name: 'Unpick bob' })).toBeNull();
  fireEvent.change(screen.getByLabelText('Find people'), { target: { value: 'ca' } });
  expect(within(screen.getByRole('list', { name: 'People' })).getAllByRole('checkbox').map((c) => c.closest('label').textContent)).toEqual(['CAcara']);
  fireEvent.click(screen.getByRole('checkbox', { name: 'cara' }));
  fireEvent.change(screen.getByLabelText('Find people'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'dee' }));
  // Full: the rest can't be picked.
  expect(screen.getByRole('checkbox', { name: 'eve' }).disabled).toBe(true);
  expect(screen.getByText('That’s as many as a group can hold.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Unpick dee' }));
  fireEvent.change(screen.getByLabelText('Group name (optional)'), { target: { value: '  Gourd Club ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Start a group (3 people)' }));
  expect(onConfirm).toHaveBeenCalledWith({ members: ['bob', 'cara'], name: 'Gourd Club' });
});

test('GroupMembersDialog: the owner removes (asks first); rename, mute; leaving says who takes over', () => {
  const handlers = { onAdd: vi.fn(), onRemove: vi.fn(), onRename: vi.fn(), onMute: vi.fn(), onLeave: vi.fn(), onClose: vi.fn() };
  const { rerender } = render(<GroupMembersDialog conversation={group} title="bob, cara and dee" myId={1} {...handlers} />);
  const list = screen.getByRole('list', { name: 'Members' });
  expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['SAsandy (you)Owner', 'BObobRemove', 'CAcaraRemove', 'DEdeeRemove']);
  expect(screen.getByText('4 of 10 members')).toBeTruthy();
  fireEvent.click(within(list).getAllByRole('button', { name: 'Remove' })[1]);
  expect(screen.getByRole('dialog', { name: 'Remove cara?' })).toBeTruthy();
  fireEvent.click(screen.getAllByRole('button', { name: 'Remove' }).at(-1));
  expect(handlers.onRemove).toHaveBeenCalledWith('cara');
  // Rename only when it changed.
  const rename = screen.getByRole('button', { name: 'Rename' });
  expect(rename.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Group name'), { target: { value: 'Gourd Club' } });
  fireEvent.click(rename);
  expect(handlers.onRename).toHaveBeenCalledWith('Gourd Club');
  fireEvent.click(screen.getByRole('switch', { name: 'Mute this group' }));
  expect(handlers.onMute).toHaveBeenCalledWith(true);
  fireEvent.click(screen.getByRole('button', { name: 'Add people' }));
  expect(handlers.onAdd).toHaveBeenCalled();
  // Leaving as the owner: bob (in longest after you) takes over.
  fireEvent.click(screen.getByRole('button', { name: 'Leave group' }));
  expect(screen.getByText('You won’t see new messages unless someone adds you back. bob becomes the owner.')).toBeTruthy();
  fireEvent.click(screen.getAllByRole('button', { name: 'Leave group' }).at(-1));
  expect(handlers.onLeave).toHaveBeenCalled();
  // Not the owner: no Remove buttons; full groups can't add.
  rerender(<GroupMembersDialog conversation={{ ...group, members: [...members, ...[5, 6, 7, 8, 9, 10].map((id) => ({ id, username: `u${id}` }))] }} title="Big" myId={2} {...handlers} />);
  expect(screen.queryAllByRole('button', { name: 'Remove' })).toHaveLength(0);
  expect(screen.getByRole('button', { name: 'Add people' }).disabled).toBe(true);
});

test('DmSidebar: a group row shows its title, member count and muted state', () => {
  render(
    <DmSidebar
      conversations={[{ ...group, muted: true }, { key: 'c:1', id: 1, kind: 'pair', username: 'bob', lastContent: 'hi' }]}
      currentDm=""
      titleOf={(c) => conversationTitle(c, 'sandy')}
      myId={1}
      unread={{ 'c:5': 2 }}
      user="sandy"
      status="open"
    />
  );
  const rows = screen.getAllByRole('button').filter((b) => /bob/.test(b.textContent));
  expect(rows[0].textContent).toMatch(/^.*bob, cara and dee4 members, muted, 2 unread2$/);
  expect(rows[0].className).toMatch(/opacity-60/);
  expect(rows[1].textContent).toMatch(/bobhi/);
});

test('DmPanel: a group’s header (members, Members button); a pair’s has Add people', () => {
  const onShowMembers = vi.fn();
  const onAddPeople = vi.fn();
  const base = { messages: [], currentUser: 'sandy', typing: [], onOpenNav: () => {}, onOpenSearch: () => {}, onSend: () => {} };
  render(<DmPanel {...base} conversationKey="c:5" conversation={group} title="Gourd Club" myId={1} onShowMembers={onShowMembers} onAddPeople={onAddPeople} />);
  expect(screen.getByRole('heading', { name: 'Gourd Club' })).toBeTruthy();
  expect(screen.getByText('4 members')).toBeTruthy();
  expect(screen.getByPlaceholderText('Message Gourd Club')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Add people' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Members' }));
  expect(onShowMembers).toHaveBeenCalled();
  cleanup();
  const onMute = vi.fn();
  render(<DmPanel {...base} conversationKey="c:1" conversation={{ id: 1, key: 'c:1', kind: 'pair', username: 'bob' }} title="bob" username="bob" myId={1} onShowMembers={onShowMembers} onAddPeople={onAddPeople} onMute={onMute} />);
  expect(screen.queryByRole('button', { name: 'Members' })).toBeNull();
  // P10-03: Add people and Mute are in the ⋯ menu.
  fireEvent.click(screen.getByRole('button', { name: 'More for bob' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Add people…' }));
  expect(onAddPeople).toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'More for bob' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Mute' }));
  expect(onMute).toHaveBeenCalledWith(true);
  expect(screen.getByPlaceholderText('Message @bob')).toBeTruthy();
});

test('MessageList: a notice is its own centered line with no actions; the up arrow skips it', () => {
  const at = 1700000000000;
  const msgs = [
    { id: 1, author: 'sandy', content: 'hello', timestamp: at, reactions: [] },
    { id: 2, author: 'sandy', content: 'sandy added bob', kind: 'system', timestamp: at + 1000, reactions: [] },
  ];
  const onEdit = vi.fn();
  const ref = { current: null };
  render(<MessageList ref={ref} messages={msgs} channel="c:5" currentUser="sandy" onEdit={onEdit} simple />);
  const note = screen.getByRole('note');
  expect(note.textContent).toMatch(/^sandy added bob/);
  expect(within(note).queryAllByRole('button')).toHaveLength(0);
  expect(screen.getAllByRole('article')).toHaveLength(1); // only the real message
  expect(ref.current.startEditLast()).toBe(true); // edits "hello", not the notice
});

test('a muted conversation doesn’t notify or sound', () => {
  const ctx = { me: 'sandy', focused: false, view: 'server', level: 'mentions', sounds: true, dmMuted: (key) => key === 'c:5' };
  expect(attentionKind({ kind: 'dm', from: 'bob', conversation: 5 }, ctx)).toBeNull();
  expect(attentionKind({ kind: 'dm', from: 'bob', conversation: 6 }, ctx)).toBe('dm');
});

// ---- P10-04: group DMs polish ----
test('the group picture: one other person is their full avatar with a badge; two or more stack; none is a tile', async () => {
  const { default: GroupAvatar } = await import('./GroupAvatar.jsx');
  const m = (username) => ({ id: username.length, username });
  const { container, rerender } = render(<GroupAvatar members={[m('cara')]} size={32} />);
  let pic = container.querySelector('[data-group-avatar]');
  expect(pic.dataset.groupAvatar).toBe('one');
  expect(pic.querySelector('div[style*="width: 32px"]')).toBeTruthy(); // full size, not shrunk into a corner
  rerender(<GroupAvatar members={[m('bob'), m('cara')]} size={32} />);
  pic = container.querySelector('[data-group-avatar]');
  expect(pic.dataset.groupAvatar).toBe('two');
  expect(pic.querySelectorAll('div[style*="width: 21px"]')).toHaveLength(2);
  expect(pic.textContent).not.toMatch(/\+/);
  rerender(<GroupAvatar members={[m('bob'), m('cara'), m('dee'), m('eve')]} size={32} />);
  expect(container.textContent).toContain('+2');
  rerender(<GroupAvatar members={[]} size={32} />);
  expect(container.querySelector('[data-group-avatar]').dataset.groupAvatar).toBe('empty');
});

test('a group’s preview names who said it; notices and pairs are left as they are', async () => {
  const { groupPreview } = await import('./DmSidebar.jsx');
  const c = { kind: 'group', members: [{ id: 1, username: 'sandy' }, { id: 2, username: 'bob' }] };
  expect(groupPreview({ ...c, lastAuthorId: 2 }, 1, 'Friday game night?')).toBe('bob: Friday game night?');
  expect(groupPreview({ ...c, lastAuthorId: 1 }, 1, 'see you')).toBe('You: see you');
  expect(groupPreview({ ...c, lastAuthorId: 2, lastKind: 'system' }, 1, 'bob started the group')).toBe('bob started the group');
  expect(groupPreview({ ...c, lastAuthorId: null }, 1, 'older server')).toBe('older server');
});

test('a new group’s welcome shows the group scene and who’s in it', () => {
  const conv = { id: 9, key: 'c:9', kind: 'group', ownerId: 1, members: [{ id: 1, username: 'sandy' }, { id: 2, username: 'bob' }, { id: 3, username: 'cara' }] };
  const { container } = render(
    <DmPanel messages={[]} currentUser="sandy" typing={[]} onOpenNav={() => {}} onOpenSearch={() => {}} onSend={() => {}} conversationKey="c:9" conversation={conv} title="Gourd Club" myId={1} />
  );
  expect(container.querySelector('svg[data-art="group"]')).toBeTruthy();
  expect(screen.getByText('You, bob and cara. Say hi! 👋')).toBeTruthy();
});

test('the Members dialog: Done is the main button; Add people says why it’s off at 10', () => {
  const members = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, username: `u${i + 1}` }));
  render(<GroupMembersDialog conversation={{ id: 5, kind: 'group', ownerId: 1, members }} title="Big" myId={1} onAdd={() => {}} onRemove={() => {}} onRename={() => {}} onMute={() => {}} onLeave={() => {}} onClose={() => {}} />);
  expect(screen.getByRole('button', { name: 'Done' }).className).toMatch(/\bbg-brand\b/);
  expect(screen.getByRole('button', { name: 'Add people' }).disabled).toBe(true);
  expect(screen.getByText('Groups hold up to 10 people.')).toBeTruthy();
});
