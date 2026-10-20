import { afterEach, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

const conversations = [{ id: 7, kind: 'pair', username: 'bob', unread: 1 }];
const listed = conversations.map((c) => ({ ...c, key: `c:${c.id}` })); // P9-06b: keyed by conversation
vi.mock('../api.js', () => ({
  getDms: vi.fn(() => Promise.resolve(conversations)),
  getDmMessages: vi.fn(() => Promise.resolve([])),
}));
const api = await import('../api.js');
const { useDms } = await import('./useDms.js');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// `send` is stable in the app (useGateway), so it must be here too.
const send = vi.fn();
const setup = (active) =>
  renderHook((props) => useDms({ user: 'sandy', send, status: 'open', ...props }), {
    initialProps: { active },
  });

test('the conversation list loads whenever the DM view opens, however you got there', async () => {
  // e.g. clicking a DM notification while in a server: select + switch view.
  const { result, rerender } = setup(false);
  expect(api.getDms).not.toHaveBeenCalled();
  act(() => result.current.select('bob')); // a username (as saved before P9-06b) finds the pair
  rerender({ active: true });
  await waitFor(() => expect(result.current.conversations).toEqual(listed));
  expect(result.current.current).toBe('c:7');
});

test('it loads when the app starts in the DM view (a reload while in DMs)', async () => {
  const { result } = setup(true);
  await waitFor(() => expect(result.current.conversations).toEqual(listed));
});

test('not while you stay in a server', () => {
  const { rerender } = setup(false);
  rerender({ active: false });
  expect(api.getDms).not.toHaveBeenCalled();
});

test('starting a brand-new DM from a server keeps it in the list after the list loads', async () => {
  const { result, rerender } = setup(false);
  act(() => result.current.open('cara')); // no messages yet, so the server doesn't list her
  rerender({ active: true });
  await waitFor(() => expect(api.getDms).toHaveBeenCalled());
  await waitFor(() => expect(result.current.conversations.map((d) => d.username)).toEqual(['cara', 'bob']));
});

test('opening a DM with unread messages marks where the new ones start (once per visit)', async () => {
  const msgs = [
    { id: 1, author: 'bob', content: 'old' },
    { id: 2, author: 'sandy', content: 'mine' },
    { id: 3, author: 'bob', content: 'new 1' },
    { id: 4, author: 'bob', content: 'new 2' },
  ];
  api.getDmMessages.mockResolvedValue(msgs);
  const { result } = setup(true);
  act(() => result.current.handlers.dm_unread({ type: 'dm_unread', counts: [{ conversation: 7, with: 'bob', count: 2 }] }));
  act(() => result.current.select('c:7'));
  await waitFor(() => expect(result.current.newMessages).toEqual({ since: 2, count: 2 }));
  expect(send).toHaveBeenCalledWith({ op: 'dm_read', conversation: 7, lastId: 4 });
  act(() => result.current.select(''));
  expect(result.current.newMessages).toBeNull();
  api.getDmMessages.mockResolvedValue([]);
});

test('P9-06b: frames, unread, typing and sending go by conversation; a new DM becomes its conversation with the first message', async () => {
  send.mockClear();
  const { result } = setup(true);
  await waitFor(() => expect(result.current.conversations).toEqual(listed));
  // Unread from the connect frame and from a frame for a conversation that isn't open.
  act(() => result.current.handlers.dm_unread({ type: 'dm_unread', counts: [{ conversation: 7, with: 'bob', count: 2 }] }));
  expect(result.current.unread).toEqual({ 'c:7': 2 });
  act(() => result.current.handlers.dm({ type: 'dm', id: 10, conversation: 7, from: 'bob', to: 'sandy', content: 'hey' }));
  expect(result.current.unread).toEqual({ 'c:7': 3 });
  expect(result.current.totalUnread).toBe(3);
  // Opening it: focus, read and send by conversation id.
  act(() => result.current.select('c:7'));
  await waitFor(() => expect(send).toHaveBeenCalledWith({ op: 'dm_focus', conversation: 7 }));
  expect(api.getDmMessages).toHaveBeenLastCalledWith('c:7');
  expect(result.current.currentConversation).toMatchObject({ key: 'c:7', username: 'bob' });
  act(() => result.current.send('hello', [], false, null));
  expect(send).toHaveBeenLastCalledWith({ op: 'dm', conversation: 7, content: 'hello', attachments: [], spoiler: false, replyTo: null });
  act(() => result.current.sendTyping());
  expect(send).toHaveBeenLastCalledWith({ op: 'dm_typing', conversation: 7 });
  // Typing shows for this conversation only.
  act(() => result.current.handlers.dm_typing({ type: 'dm_typing', from: 'bob', conversation: 7 }));
  act(() => result.current.handlers.dm_typing({ type: 'dm_typing', from: 'cara', conversation: 8 }));
  expect(result.current.typingNames).toEqual(['bob']);
  // A live message in the open conversation is shown and read.
  act(() => result.current.handlers.dm({ type: 'dm', id: 11, conversation: 7, from: 'bob', to: 'sandy', content: 'still there?' }));
  expect(result.current.messages.map((m) => m.id)).toContain(11);
  expect(send).toHaveBeenLastCalledWith({ op: 'dm_read', conversation: 7, lastId: 11 });

  // Someone you've never messaged: `@cara` until the first message makes it a conversation.
  act(() => result.current.open('cara'));
  expect(result.current.current).toBe('@cara');
  await waitFor(() => expect(send).toHaveBeenCalledWith({ op: 'dm_focus', with: 'cara' }));
  expect(api.getDmMessages).toHaveBeenLastCalledWith('@cara');
  act(() => result.current.send('hi cara', [], false, null));
  expect(send).toHaveBeenLastCalledWith({ op: 'dm', to: 'cara', content: 'hi cara', attachments: [], spoiler: false, replyTo: null });
  act(() => result.current.handlers.dm({ type: 'dm', id: 12, conversation: 9, from: 'sandy', to: 'cara', content: 'hi cara' }));
  expect(result.current.current).toBe('c:9');
  await waitFor(() => expect(send).toHaveBeenCalledWith({ op: 'dm_focus', conversation: 9 }));
  expect(result.current.unread['c:9']).toBeUndefined(); // your own first message isn't unread
});

test('P9-06d: group frames: a summary adds or updates it; the one you made opens; leaving closes it and tells you; refusals; notices', async () => {
  send.mockClear();
  const onLeft = vi.fn();
  const onIncoming = vi.fn();
  const { result } = renderHook((props) => useDms({ user: 'sandy', send, status: 'open', active: true, onLeft, onIncoming, ...props }));
  await waitFor(() => expect(result.current.conversations).toEqual(listed));
  const summary = { id: 5, kind: 'group', name: null, ownerId: 1, muted: false, members: [{ id: 1, username: 'sandy' }, { id: 2, username: 'bob' }, { id: 3, username: 'cara' }], unread: 0 };
  act(() => result.current.handlers.dm_conversation({ type: 'dm_conversation', conversation: summary }));
  expect(result.current.conversations[0]).toMatchObject({ key: 'c:5', kind: 'group' });
  expect(result.current.title(result.current.conversations[0])).toBe('bob and cara');
  act(() => result.current.handlers.dm_conversation({ type: 'dm_conversation', conversation: { ...summary, name: 'Gourd Club', muted: true } }));
  expect(result.current.conversations.filter((c) => c.key === 'c:5')).toEqual([expect.objectContaining({ name: 'Gourd Club', muted: true })]);
  // The group you made opens.
  act(() => result.current.handlers.dm_group_created({ type: 'dm_group_created', conversation: 5 }));
  expect(result.current.current).toBe('c:5');
  expect(result.current.currentConversation).toMatchObject({ name: 'Gourd Club' });
  // A notice is shown but doesn't notify; a message from the group does, and counts as from the group.
  act(() => result.current.handlers.dm({ type: 'dm', kind: 'system', id: 30, conversation: 5, from: 'sandy', to: null, content: 'sandy started the group' }));
  expect(result.current.messages.at(-1)).toMatchObject({ id: 30, kind: 'system' });
  expect(onIncoming).not.toHaveBeenCalled();
  act(() => result.current.handlers.dm({ type: 'dm', id: 31, conversation: 5, from: 'bob', to: null, content: 'hi all' }));
  expect(onIncoming).toHaveBeenCalledWith(expect.objectContaining({ kind: 'dm', conversation: 5, from: 'bob' }));
  // Actions send the group ops.
  act(() => result.current.createGroup(['bob', 'cara'], 'Club'));
  expect(send).toHaveBeenLastCalledWith({ op: 'dm_group_create', members: ['bob', 'cara'], name: 'Club' });
  act(() => result.current.addToGroup(5, ['dee']));
  expect(send).toHaveBeenLastCalledWith({ op: 'dm_group_add', conversation: 5, members: ['dee'] });
  act(() => result.current.removeFromGroup(5, 'cara'));
  expect(send).toHaveBeenLastCalledWith({ op: 'dm_group_remove', conversation: 5, member: 'cara' });
  act(() => result.current.renameGroup(5, 'Squash'));
  expect(send).toHaveBeenLastCalledWith({ op: 'dm_group_rename', conversation: 5, name: 'Squash' });
  act(() => result.current.setMuted(5, false));
  expect(send).toHaveBeenLastCalledWith({ op: 'dm_mute', conversation: 5, muted: false });
  act(() => result.current.leaveGroup(5));
  expect(send).toHaveBeenLastCalledWith({ op: 'dm_group_leave', conversation: 5 });
  // A refusal is kept for the app to show; other ops' errors aren't.
  act(() => result.current.handlers.error({ type: 'error', op: 'message', code: 'SLOWMODE' }));
  expect(result.current.groupError).toBeNull();
  act(() => result.current.handlers.error({ type: 'error', op: 'dm_group_add', code: 'NOT_ALLOWED', error: 'You can only add…' }));
  expect(result.current.groupError).toEqual({ op: 'dm_group_add', code: 'NOT_ALLOWED', error: 'You can only add…' });
  // Removed: gone from the list and the view; the app is told.
  act(() => result.current.handlers.dm_left({ type: 'dm_left', conversation: 5, reason: 'removed', name: 'Gourd Club' }));
  expect(result.current.conversations.some((c) => c.key === 'c:5')).toBe(false);
  expect(result.current.current).toBe('');
  expect(onLeft).toHaveBeenCalledWith(expect.objectContaining({ reason: 'removed', name: 'Gourd Club' }));
});

test('P9-06d: with a new 1-to-1 open, a group message from that person doesn’t take it over', async () => {
  const { result } = setup(true);
  await waitFor(() => expect(result.current.conversations).toEqual(listed));
  act(() => result.current.open('cara'));
  act(() => result.current.handlers.dm({ type: 'dm', id: 40, conversation: 9, from: 'cara', to: null, content: 'in a group' }));
  expect(result.current.current).toBe('@cara');
  expect(result.current.unread['c:9']).toBe(1);
});
