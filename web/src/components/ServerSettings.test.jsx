// P5-04: one Server settings window instead of a window per menu item; a
// short server menu; role permissions in groups.
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

vi.mock('../api.js', () => ({
  getEmoji: vi.fn(async () => []),
  getModLog: vi.fn(async () => ({ entries: [], more: false })),
  getBans: vi.fn(async () => ({ bans: [] })),
  setServerImagine: vi.fn(),
}));
const { default: ChannelList } = await import('./ChannelList.jsx');
const { PERMISSION_ACTIONS, PERMISSION_GROUPS } = await import('../util.js');

afterEach(cleanup);

function list(props = {}) {
  return render(
    <ChannelList
      space="Tx" channels={['general']} currentChannel="general" voiceChannels={[]} voiceParticipants={{}} activeVoiceParticipants={[]}
      user="sandy" status="open" selfId={1} onSelect={() => {}} onInvite={() => {}} channelMeta={{ general: { type: 'text' } }}
      {...props}
    />
  );
}
const openMenu = () => fireEvent.click(screen.getByRole('button', { name: 'Tx' }));
const menuItems = () => screen.getByRole('button', { name: /Invite people/ }).parentElement.querySelectorAll('button');
const openSettings = () => {
  openMenu();
  fireEvent.click(screen.getByRole('button', { name: /Server settings/ }));
  return screen.getByRole('dialog', { name: 'Server settings' });
};
const owner = {
  isOwner: true, canManage: true, canManageEmoji: true, canManageRoles: true, role: 'owner', abilities: [],
  imagineInfo: { serverEnabled: false, engines: [{ id: 'comfyui' }] }, roles: [{ id: 1, name: '@everyone', isDefault: true, permissions: [], members: [] }], members: [],
};

test('the owner menu is short: Invite, Create channel, Create category, Server settings', () => {
  list(owner);
  openMenu();
  expect([...menuItems()].map((b) => b.textContent.trim())).toEqual(['Invite people', 'Create channel', 'Create category', 'Server settings']);
});

test('the owner sees every section, Moderation as a group', () => {
  list(owner);
  const dialog = openSettings();
  expect(within(dialog).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Overview', 'Emoji', 'Roles', 'Image generation', 'Reports', 'Moderation log', 'Bans']);
  expect(within(dialog).getByText('Moderation')).toBeTruthy();
  expect(within(dialog).getByText('Tx')).toBeTruthy(); // the server's name under the title
});

test('a member who may only manage emoji sees only Emoji; one who may manage nothing has no Server settings', () => {
  list({ canManageEmoji: true, role: 'member', abilities: ['manage_emoji'] });
  const dialog = openSettings();
  expect(within(dialog).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Emoji']);
  cleanup();
  list({ role: 'member', abilities: [] });
  openMenu();
  expect(screen.queryByRole('button', { name: /Server settings/ })).toBeNull();
});

test('Overview: renaming waits for the save bar; Reset puts the name back; an icon uploads at once', () => {
  const onRenameServer = vi.fn();
  const onChangeServerIcon = vi.fn();
  list({ ...owner, onRenameServer, onChangeServerIcon });
  const dialog = openSettings();
  const name = within(dialog).getByLabelText('Server name');
  fireEvent.change(name, { target: { value: 'Tx 2' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Reset' }));
  expect(name.value).toBe('Tx');
  fireEvent.change(name, { target: { value: '  Tx Check  ' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
  expect(onRenameServer).toHaveBeenCalledWith('Tx Check');
  const file = new File(['x'], 'icon.png', { type: 'image/png' });
  fireEvent.change(within(dialog).getByLabelText('Server icon'), { target: { files: [file] } });
  expect(onChangeServerIcon).toHaveBeenCalledWith(file);
});

test('Delete server is only in Overview’s danger zone, and only for the owner', () => {
  list({ ...owner });
  let dialog = openSettings();
  expect(within(within(dialog).getByRole('region', { name: 'Danger zone' })).getByRole('button', { name: 'Delete server' })).toBeTruthy();
  cleanup();
  list({ canManage: true, role: 'admin', abilities: ['edit_server'] });
  dialog = openSettings();
  expect(within(dialog).getByLabelText('Server name')).toBeTruthy();
  expect(within(dialog).queryByRole('region', { name: 'Danger zone' })).toBeNull();
});

test('closing with an unsaved rename asks first', () => {
  list(owner);
  const dialog = openSettings();
  fireEvent.change(within(dialog).getByLabelText('Server name'), { target: { value: 'Other' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
  expect(screen.getByRole('dialog', { name: 'Discard changes?' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
  expect(screen.queryByRole('dialog', { name: 'Server settings' })).toBeNull();
});

test('role permissions come in five groups, each permission exactly once', () => {
  expect(PERMISSION_GROUPS.map((g) => g.label)).toEqual(['Channels', 'Members', 'Messages', 'Server', 'Images']);
  const keys = PERMISSION_GROUPS.flatMap((g) => g.actions.map((a) => a.key));
  expect([...keys].sort()).toEqual(PERMISSION_ACTIONS.map((a) => a.key).sort());
  list({ ...owner, roles: [{ id: 2, name: 'Mods', position: 1, permissions: ['pin_messages'], members: [] }, ...owner.roles] });
  const dialog = openSettings();
  fireEvent.click(within(dialog).getByRole('tab', { name: 'Roles' }));
  const messages = within(dialog).getByRole('group', { name: 'Messages' });
  expect(within(messages).getByRole('checkbox', { name: 'Pin messages' }).checked).toBe(true);
});
