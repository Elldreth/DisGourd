// P5-05: channel settings in three tabs; the member menu names the member and
// keeps moderation apart.
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('../api.js', () => ({
  getChannelOverrides: vi.fn(async () => ({ overrides: [] })),
  getCategoryOverrides: vi.fn(async () => ({ overrides: [] })),
  setChannelOverrides: vi.fn(async () => ({})),
  setChannelNsfw: vi.fn(async () => ({})),
  setChannelSlowmode: vi.fn(async () => ({})),
  setChannelTopic: vi.fn(async () => ({})),
}));
const api = await import('../api.js');
const { default: ChannelSettingsDialog } = await import('./ChannelSettingsDialog.jsx');
const { default: MemberList } = await import('./MemberList.jsx');

afterEach(cleanup);

const roles = [{ id: 1, name: '@everyone', isDefault: true, position: 0, permissions: [] }];
const tabsOf = (dialog) => within(within(dialog).getByRole('tablist')).getAllByRole('tab').map((t) => t.textContent);

test('a text channel has Overview, Permissions and Moderation tabs; Overview first', async () => {
  render(<ChannelSettingsDialog space="S" channel="general" meta={{ type: 'text' }} roles={roles} isOwner onClose={() => {}} onSaved={() => {}} />);
  const dialog = screen.getByRole('dialog', { name: '#general settings' });
  expect(tabsOf(dialog)).toEqual(['Overview', 'Permissions', 'Moderation']);
  expect(within(dialog).getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe('true');
  // Overview: the topic, the 18+ switch and the danger zone.
  expect(within(dialog).getByLabelText('Topic')).toBeTruthy();
  expect(within(dialog).getByRole('switch', { name: /Age-restricted/ })).toBeTruthy();
  expect(within(dialog).getByRole('button', { name: /Delete channel/ })).toBeTruthy();
  // Moderation: slow mode, one tab away.
  fireEvent.click(within(dialog).getByRole('tab', { name: 'Moderation' }));
  expect(within(dialog).getByRole('combobox', { name: 'Slow mode' })).toBeTruthy();
  // Permissions: the role table.
  fireEvent.click(within(dialog).getByRole('tab', { name: 'Permissions' }));
  expect(await within(dialog).findByRole('combobox', { name: '@everyone: view' })).toBeTruthy();
});

test('Save sends what changed on every tab', async () => {
  const onSaved = vi.fn();
  render(<ChannelSettingsDialog space="S" channel="general" meta={{ type: 'text', topic: '' }} roles={roles} isOwner onClose={() => {}} onSaved={onSaved} />);
  const dialog = screen.getByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('Topic'), { target: { value: 'Say hi' } });
  fireEvent.click(within(dialog).getByRole('tab', { name: 'Moderation' }));
  fireEvent.change(within(dialog).getByRole('combobox', { name: 'Slow mode' }), { target: { value: '30' } });
  fireEvent.click(within(dialog).getByRole('tab', { name: 'Permissions' }));
  fireEvent.change(await within(dialog).findByRole('combobox', { name: '@everyone: post' }), { target: { value: '0' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  expect(api.setChannelTopic).toHaveBeenCalledWith('S', 'general', 'Say hi');
  expect(api.setChannelSlowmode).toHaveBeenCalledWith('S', 'general', 30);
  expect(api.setChannelOverrides).toHaveBeenCalledWith('S', 'general', [{ roleId: 1, view: null, post: 0 }]);
});

test('a voice channel has no Moderation tab; a category has no tabs at all', () => {
  render(<ChannelSettingsDialog space="S" channel="Lounge" meta={{ type: 'voice' }} roles={roles} isOwner onClose={() => {}} onSaved={() => {}} />);
  expect(tabsOf(screen.getByRole('dialog'))).toEqual(['Overview', 'Permissions']);
  cleanup();
  render(<ChannelSettingsDialog space="S" category={{ id: 3, name: 'Games' }} roles={roles} isOwner onClose={() => {}} onSaved={() => {}} />);
  expect(within(screen.getByRole('dialog')).queryByRole('tablist')).toBeNull();
});

test('the move buttons say they move the channel', () => {
  const placement = { categories: [{ id: 1, name: 'Text' }], category: 1, canUp: true, canDown: false, onMove: vi.fn(), onMoveTo: vi.fn() };
  render(<ChannelSettingsDialog space="S" channel="general" meta={{ type: 'text' }} placement={placement} roles={roles} isOwner onClose={() => {}} onSaved={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Move channel up' }));
  expect(placement.onMove).toHaveBeenCalledWith(-1);
  expect(screen.getByRole('button', { name: 'Move channel down' }).disabled).toBe(true);
});

const members = [
  { username: 'sandy', online: true, role: 'owner', roles: [] },
  { username: 'bob', status: 'idle', role: 'member', roles: [2], position: 1 },
];
const memberRoles = [{ id: 2, name: 'Mods', position: 1 }, { id: 1, name: '@everyone', isDefault: true, position: 0 }];

function menuFor(name, props = {}) {
  render(
    <MemberList members={members} roles={memberRoles} currentUser="sandy" myRole="owner" myPosition={1e9} canKickMembers canBanMembers canTimeoutMembers canManageRoles
      onMessageUser={() => {}} onToggleRole={() => {}} onKick={() => {}} onBan={() => {}} onTimeout={() => {}} onRemoveTimeout={() => {}} {...props} />
  );
  fireEvent.click(screen.getByText(name).closest('button'));
  return screen.getByRole('group', { name: `Actions for ${name}` });
}

test('the member menu names the member: avatar, name, top role and status', () => {
  const menu = menuFor('bob');
  const header = within(menu).getByTestId('member-menu-header');
  expect(header.textContent).toContain('bob');
  expect(header.textContent).toContain('Mods');
  expect(header.textContent).toContain('Idle');
});

test('moderation comes after a separator: Time out in amber, Remove and Ban in red', () => {
  const menu = menuFor('bob');
  const buttons = within(menu).getAllByRole('button').map((b) => b.textContent);
  expect(buttons).toEqual(['Message', 'Roles…', 'Time out…', 'Remove from server', 'Ban…']);
  const sep = within(menu).getByRole('separator');
  expect(sep.nextElementSibling.textContent).toBe('Time out…');
  expect(within(menu).getByRole('button', { name: 'Time out…' }).className).toMatch(/\btext-idle\b/);
  expect(within(menu).getByRole('button', { name: 'Remove from server' }).className).toMatch(/\btext-danger\b/);
  expect(within(menu).getByRole('button', { name: 'Ban…' }).className).toMatch(/\btext-danger\b/);
});

test('without moderation permissions there is no separator', () => {
  const menu = menuFor('bob', { canKickMembers: false, canBanMembers: false, canTimeoutMembers: false });
  expect(within(menu).queryByRole('separator')).toBeNull();
  expect(within(menu).getAllByRole('button').map((b) => b.textContent)).toEqual(['Message', 'Roles…']);
});
