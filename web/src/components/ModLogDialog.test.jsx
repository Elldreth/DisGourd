// P3-26a: the moderation log dialog and its server-menu item.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const at = new Date(2026, 9, 19, 15, 42).getTime();
const page1 = {
  entries: [
    { id: 9, action: 'message_delete', actor: 'sandy', target: 'bob', reason: null, details: { channel: 'general', excerpt: 'buy cheap gourds' }, createdAt: at },
    { id: 8, action: 'kick', actor: 'sandy', target: 'cara', reason: 'spamming', details: null, createdAt: at },
    { id: 7, action: 'role_add', actor: 'sandy', target: 'bob', reason: null, details: { role: 'Helpers' }, createdAt: at },
    { id: 6, action: 'role_remove', actor: 'sandy', target: 'bob', reason: null, details: { role: 'Helpers' }, createdAt: at },
    { id: 5, action: 'channel_access', actor: 'sandy', target: null, reason: null, details: { channel: 'staff', roles: [{ role: '@everyone', view: false, post: null }] }, createdAt: at },
  ],
  more: true,
};
const page2 = { entries: [{ id: 3, action: 'category_access', actor: 'sandy', target: null, reason: null, details: { category: 'Staff area', roles: [{ role: 'Mods', view: true, post: false }] }, createdAt: at }], more: false };

vi.mock('../api.js', () => ({ getModLog: vi.fn() }));
vi.mock('../audio.js', async (orig) => ({ ...(await orig()), displayCaptureSupported: () => true }));
const api = await import('../api.js');
const { default: ModLogDialog } = await import('./ModLogDialog.jsx');
const { default: ChannelList } = await import('./ChannelList.jsx');

beforeEach(() => {
  vi.clearAllMocks();
  api.getModLog.mockImplementation(async (space, { before } = {}) => (before ? page2 : page1));
});
afterEach(cleanup);

test('lists entries readably, newest first, and loads older ones', async () => {
  render(<ModLogDialog space="Tx" members={[{ username: 'bob' }, { username: 'cara' }]} onClose={() => {}} />);
  expect(screen.getByRole('dialog', { name: 'Moderation log — Tx' })).toBeTruthy();
  await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(5));
  const items = screen.getAllByRole('listitem').map((li) => li.textContent);
  expect(items[0]).toContain('sandy deleted a message by bob in #general: “buy cheap gourds”');
  expect(items[1]).toContain('sandy removed cara from the server');
  expect(items[1]).toContain('Reason: spamming');
  expect(items[2]).toContain('sandy gave bob the Helpers role');
  expect(items[3]).toContain('sandy took the Helpers role from bob');
  expect(items[4]).toContain("sandy changed access to #staff (@everyone: can't view)");
  expect(api.getModLog).toHaveBeenCalledWith('Tx', { before: undefined, action: '', user: '' });

  fireEvent.click(screen.getByRole('button', { name: 'Load older' }));
  await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(6));
  expect(api.getModLog).toHaveBeenLastCalledWith('Tx', { before: 5, action: '', user: '' });
  expect(screen.getAllByRole('listitem')[5].textContent).toContain('changed access to the Staff area category (Mods: can view, can\'t post)');
  expect(screen.queryByRole('button', { name: 'Load older' })).toBeNull();
});

test('filters by action and by person', async () => {
  render(<ModLogDialog space="Tx" members={[{ username: 'bob' }]} onClose={() => {}} />);
  await waitFor(() => expect(api.getModLog).toHaveBeenCalledTimes(1));
  api.getModLog.mockResolvedValue({ entries: [], more: false });
  fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'kick' } });
  await waitFor(() => expect(api.getModLog).toHaveBeenLastCalledWith('Tx', { before: undefined, action: 'kick', user: '' }));
  fireEvent.change(screen.getByLabelText('Person'), { target: { value: 'bob' } });
  await waitFor(() => expect(api.getModLog).toHaveBeenLastCalledWith('Tx', { before: undefined, action: 'kick', user: 'bob' }));
  expect(await screen.findByText('Nothing logged yet for this filter.')).toBeTruthy();
});

test('shows an error from the server', async () => {
  api.getModLog.mockRejectedValue(new Error('You are not allowed to see the moderation log'));
  render(<ModLogDialog space="Tx" onClose={() => {}} />);
  expect((await screen.findByRole('alert')).textContent).toBe('You are not allowed to see the moderation log');
});

function list(props) {
  return render(
    <ChannelList
      space="Logland" channels={['general']} currentChannel="general" voiceChannels={[]} voiceParticipants={{}} activeVoiceParticipants={[]}
      user="sandy" status="open" selfId={1} onSelect={() => {}} channelMeta={{ general: { type: 'text' } }}
      {...props}
    />
  );
}

test('the server menu offers the log only to people with a moderation permission', async () => {
  list({ abilities: ['invite'], role: 'member' });
  fireEvent.click(screen.getByRole('button', { name: 'Logland' }));
  expect(screen.queryByText('Moderation log')).toBeNull();
  cleanup();

  list({ abilities: ['delete_others_messages'], role: 'admin' });
  fireEvent.click(screen.getByRole('button', { name: 'Logland' }));
  fireEvent.click(screen.getByText('Moderation log'));
  expect(await screen.findByRole('dialog', { name: 'Moderation log — Logland' })).toBeTruthy();
  cleanup();

  list({ abilities: [], isOwner: true, role: 'owner' });
  fireEvent.click(screen.getByRole('button', { name: 'Logland' }));
  expect(screen.getByText('Moderation log')).toBeTruthy();
});
