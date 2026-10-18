import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('../api.js', () => ({
  createRole: vi.fn(async () => ({ role: { id: 9 } })),
  updateRole: vi.fn(async () => ({ role: {} })),
  deleteRole: vi.fn(async () => ({ ok: true })),
  reorderRoles: vi.fn(async () => ({ roles: [] })),
  setMemberHasRole: vi.fn(async () => ({ roles: [] })),
  getChannelOverrides: vi.fn(async () => ({ overrides: [] })),
  setChannelOverrides: vi.fn(async () => ({ overrides: [] })),
}));
const api = await import('../api.js');
const { default: RolesDialog } = await import('./RolesDialog.jsx');
const { default: ChannelSettingsDialog } = await import('./ChannelSettingsDialog.jsx');
const { default: MemberList } = await import('./MemberList.jsx');

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

// Highest first, as the server sends them.
const roles = [
  { id: 2, name: 'Admin', color: null, position: 3, isDefault: false, permissions: ['kick', 'manage_roles'], members: ['cara'] },
  { id: 3, name: 'Managers', color: '#0090ff', position: 2, isDefault: false, permissions: ['manage_roles', 'pin_messages'], members: ['mgr'] },
  { id: 4, name: 'Mods', color: '#ff8800', position: 1, isDefault: false, permissions: ['pin_messages'], members: ['bob'] },
  { id: 1, name: '@everyone', color: null, position: 0, isDefault: true, permissions: ['invite'], members: [] },
];
const members = [
  { username: 'sandy', role: 'owner', position: 1e9, roles: [] },
  { username: 'cara', role: 'member', position: 3, roles: [2] },
  { username: 'mgr', role: 'member', position: 2, roles: [3] },
  { username: 'bob', role: 'member', position: 1, roles: [4] },
  { username: 'dee', role: 'member', position: 0, roles: [] },
];
const asOwner = (props = {}) =>
  render(<RolesDialog space="S" roles={roles} members={members} currentUser="sandy" isOwner myPosition={1e9} abilities={[]} onClose={() => {}} onChanged={() => {}} {...props} />);
const asManager = (props = {}) =>
  render(<RolesDialog space="S" roles={roles} members={members} currentUser="mgr" isOwner={false} myPosition={2} abilities={['manage_roles', 'pin_messages', 'invite']} onClose={() => {}} onChanged={() => {}} {...props} />);
const roleButton = (name) => within(screen.getByRole('list', { name: 'Roles' })).getByRole('button', { name: new RegExp(`^${name}`) });

test('lists the roles highest first and opens on the top one', () => {
  asOwner();
  const names = within(screen.getByRole('list', { name: 'Roles' })).getAllByRole('listitem').map((li) => li.textContent);
  expect(names[0]).toMatch(/^Admin/);
  expect(names.at(-1)).toMatch(/^@everyone/);
  expect(roleButton('Admin').getAttribute('aria-current')).toBe('true');
  expect(screen.getByLabelText('Role name').value).toBe('Admin');
});

test('Create role makes "New role" and selects it', async () => {
  const onChanged = vi.fn();
  asOwner({ onChanged });
  fireEvent.click(screen.getByRole('button', { name: /Create role/ }));
  await waitFor(() => expect(api.createRole).toHaveBeenCalledWith('S', { name: 'New role', permissions: [] }));
  expect(onChanged).toHaveBeenCalled();
});

test('Move up / Move down reorder the roles, sent bottom to top', async () => {
  asOwner();
  expect(screen.getByRole('button', { name: 'Move Admin up' }).disabled).toBe(true);
  expect(screen.getByRole('button', { name: 'Move Mods down' }).disabled).toBe(true);
  expect(screen.queryByRole('button', { name: 'Move @everyone up' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Move Mods up' }));
  await waitFor(() => expect(api.reorderRoles).toHaveBeenCalledWith('S', [3, 4, 2]));
});

test('editing name, colour and permissions, then Save', async () => {
  asOwner();
  fireEvent.click(roleButton('Mods'));
  fireEvent.change(screen.getByLabelText('Role name'), { target: { value: 'Moderators' } });
  fireEvent.click(screen.getByRole('radio', { name: '#46a758' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Remove members' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() =>
    expect(api.updateRole).toHaveBeenCalledWith('S', 4, { name: 'Moderators', color: '#46a758', permissions: ['pin_messages', 'kick'] })
  );
});

test("@everyone: permissions only; it can't be renamed or deleted", () => {
  asOwner();
  fireEvent.click(roleButton('@everyone'));
  expect(screen.getByLabelText('Role name').disabled).toBe(true);
  expect(screen.queryByRole('radio', { name: 'No colour' })).toBeNull();
  expect(screen.queryByRole('button', { name: /Delete role/ })).toBeNull();
  expect(screen.getByRole('checkbox', { name: 'Invite people' }).checked).toBe(true);
});

test('members of a role: add from the list and remove', async () => {
  asOwner();
  fireEvent.click(roleButton('Mods'));
  const section = screen.getByRole('region', { name: 'Members with this role' });
  expect(within(section).getByText('bob')).toBeTruthy();
  fireEvent.click(within(section).getByRole('button', { name: 'Remove bob from Mods' }));
  await waitFor(() => expect(api.setMemberHasRole).toHaveBeenCalledWith('S', 'bob', 4, false));
  fireEvent.change(within(section).getByLabelText('Member to add'), { target: { value: 'dee' } });
  fireEvent.click(within(section).getByRole('button', { name: 'Add' }));
  await waitFor(() => expect(api.setMemberHasRole).toHaveBeenCalledWith('S', 'dee', 4, true));
});

test('Delete role asks first', async () => {
  asOwner();
  fireEvent.click(roleButton('Mods'));
  fireEvent.click(screen.getByRole('button', { name: /Delete role/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Delete role' }));
  await waitFor(() => expect(api.deleteRole).toHaveBeenCalledWith('S', 4));
});

test('a manager: roles at or above them are read-only; permissions they lack are locked', () => {
  asManager();
  // Admin (above) and Managers (their own) are locked; only Mods moves.
  expect(screen.getByText('You can only change roles below your own.')).toBeTruthy();
  expect(screen.getByLabelText('Role name').disabled).toBe(true);
  expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Move Admin up' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Move Managers down' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Move Mods up' }).disabled).toBe(true); // the top of what they manage
  fireEvent.click(roleButton('Mods'));
  expect(screen.getByLabelText('Role name').disabled).toBe(false);
  expect(screen.getByRole('checkbox', { name: 'Pin messages' }).disabled).toBe(false);
  expect(screen.getByRole('checkbox', { name: 'Remove members' }).disabled).toBe(true); // they don't hold kick
  // They can add members below them (or themselves), not cara above.
  const options = within(screen.getByLabelText('Member to add')).getAllByRole('option').map((o) => o.value);
  expect(options).toEqual(['', 'mgr', 'dee']);
});

test('channel settings: a per-role table that saves overrides; roles above you are locked', async () => {
  api.getChannelOverrides.mockResolvedValueOnce({ overrides: [{ roleId: 1, view: 0, post: null }, { roleId: 4, view: 1, post: 1 }] });
  const onSaved = vi.fn();
  render(<ChannelSettingsDialog space="S" channel="vault" meta={{ type: 'text' }} roles={roles} isOwner={false} myPosition={2} onClose={() => {}} onSaved={onSaved} />);
  await waitFor(() => expect(screen.getByLabelText('@everyone: view').value).toBe('0'));
  expect(screen.getByLabelText('Mods: post').value).toBe('1');
  expect(screen.getByLabelText('Admin: view').disabled).toBe(true);
  expect(screen.getByLabelText('Managers: view').disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Mods: post'), { target: { value: '0' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(api.setChannelOverrides).toHaveBeenCalledWith('S', 'vault', [
      { roleId: 1, view: 0, post: null },
      { roleId: 4, view: 1, post: 0 },
    ])
  );
  expect(onSaved).toHaveBeenCalled();
});

test('voice channel settings show only who can see and join', async () => {
  render(<ChannelSettingsDialog space="S" channel="Lounge" meta={{ type: 'voice' }} roles={roles} isOwner myPosition={1e9} onClose={() => {}} onSaved={() => {}} />);
  await waitFor(() => expect(screen.getByLabelText('@everyone: see and join')).toBeTruthy());
  expect(screen.queryByLabelText('@everyone: post')).toBeNull();
});

test('member list: badges show the top role, and Roles… gives and takes roles', async () => {
  const onToggleRole = vi.fn(async () => {});
  render(
    <MemberList space="S" members={members} roles={roles} currentUser="mgr" myRole="member" canManageRoles myPosition={2} onMessageUser={() => {}} onToggleRole={onToggleRole} onKick={() => {}} />
  );
  expect(screen.getByRole('button', { name: /sandy/ }).textContent).toContain('Owner');
  expect(screen.getByRole('button', { name: /cara/ }).textContent).toContain('Admin');
  expect(screen.getByRole('button', { name: /bob/ }).textContent).toContain('Mods');
  // cara sits above the manager: no Roles… for her.
  fireEvent.click(screen.getByRole('button', { name: /cara/ }));
  expect(screen.queryByRole('button', { name: 'Roles…' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /dee/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Roles…' }));
  const dialog = screen.getByRole('dialog', { name: 'Roles for dee' });
  expect(within(dialog).getByRole('checkbox', { name: /Admin/ }).disabled).toBe(true);
  fireEvent.click(within(dialog).getByRole('checkbox', { name: /Mods/ }));
  await waitFor(() => expect(onToggleRole).toHaveBeenCalledWith('dee', 4, true));
});

test('the Roles… checklist keeps keyboard focus while a change saves, so Esc still closes it', async () => {
  let finish;
  const onToggleRole = vi.fn(() => new Promise((r) => (finish = r)));
  render(
    <MemberList space="S" members={members} roles={roles} currentUser="sandy" myRole="owner" canManageRoles myPosition={1e9} onMessageUser={() => {}} onToggleRole={onToggleRole} onKick={() => {}} />
  );
  fireEvent.click(screen.getByRole('button', { name: /dee/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Roles…' }));
  const dialog = screen.getByRole('dialog', { name: 'Roles for dee' });
  const box = within(dialog).getByRole('checkbox', { name: /Mods/ });
  box.focus();
  fireEvent.click(box);
  expect(box.disabled).toBe(false);
  expect(document.activeElement).toBe(box);
  fireEvent.click(within(dialog).getByRole('checkbox', { name: /Admin/ })); // ignored while saving
  expect(onToggleRole).toHaveBeenCalledTimes(1);
  finish();
  await waitFor(() => expect(onToggleRole).toHaveBeenCalledWith('dee', 4, true));
  fireEvent.keyDown(document.activeElement, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Roles for dee' })).toBeNull());
});
