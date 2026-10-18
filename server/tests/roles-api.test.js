// P2-21c: the roles API — create, edit, reorder and delete roles, give and
// take them, per-channel overrides — with the hierarchy enforced, and role
// edits that stick when channels and threads are made.
const os = require('os');
const path = require('path');

let serverModule;
let db;
let port;
const users = {}; // name -> { token, id }
const SPACE = 'Guild';

beforeAll((done) => {
  process.env.PORT = 0;
  process.env.JWT_SECRET = 'disgourd-test-secret-0123456789abcdef';
  process.env.DB_PATH = ':memory:';
  process.env.UPLOADS_DIR = path.join(os.tmpdir(), `disgourd-test-uploads-roles3-${process.pid}`);
  serverModule = require('../server');
  db = serverModule.db;
  serverModule.httpServer.listen(0, () => {
    port = serverModule.httpServer.address().port;
    done();
  });
});
afterAll((done) => {
  serverModule.httpServer.close(done);
});

const base = () => `http://localhost:${port}`;
const call = async (who, method, p, body) => {
  const res = await fetch(`${base()}${p}`, {
    method,
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${users[who].token}` },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const S = `/spaces/${SPACE}`;
const rolesOf = async (who = 'owner') => (await call(who, 'GET', `${S}/roles`)).body.roles;
const roleNamed = async (name) => (await rolesOf()).find((r) => r.name === name);

async function register(username) {
  const res = await fetch(`${base()}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'password123', email: `${username}@example.com` }),
  });
  return (await res.json()).token;
}

let spaceId;
beforeAll(async () => {
  for (const name of ['owner', 'mgr', 'bob', 'cara']) {
    const token = await register(name);
    users[name] = { token, id: db.getUserByUsername(name).id };
  }
  spaceId = db.createSpaceWithDefaults(SPACE, users.owner.id);
  for (const n of ['mgr', 'bob', 'cara']) db.addMember(spaceId, users[n].id, 'member');
});

test('any member can read the roles, highest first, with who holds each', async () => {
  db.setMemberRole(spaceId, users.cara.id, 'admin');
  const roles = await rolesOf('bob');
  expect(roles.map((r) => r.name)).toEqual(['Admin', '@everyone']);
  expect(roles[0]).toMatchObject({ members: ['cara'], isDefault: false });
  expect(roles[1]).toMatchObject({ members: [], isDefault: true });
  db.setMemberRole(spaceId, users.cara.id, 'member');
  expect((await call('bob', 'POST', `${S}/roles`, { name: 'Nope' })).status).toBe(403); // no manage_roles
});

test('the owner creates a role at the bottom, edits it, and deletes it', async () => {
  const made = await call('owner', 'POST', `${S}/roles`, { name: 'Mods', color: '#FF8800', permissions: ['pin_messages', 'bogus'] });
  expect(made.status).toBe(201);
  expect(made.body.role).toMatchObject({ name: 'Mods', color: '#ff8800', permissions: ['pin_messages'], position: 1 });
  expect((await rolesOf()).map((r) => r.name)).toEqual(['Admin', 'Mods', '@everyone']);
  expect((await call('owner', 'POST', `${S}/roles`, { name: 'Mods' })).status).toBe(409);
  expect((await call('owner', 'POST', `${S}/roles`, { name: '@everyone' })).status).toBe(400);
  expect((await call('owner', 'POST', `${S}/roles`, { name: 'X', color: 'red' })).status).toBe(400);

  const id = made.body.role.id;
  const edited = await call('owner', 'PATCH', `${S}/roles/${id}`, { name: 'Moderators', color: null, permissions: ['pin_messages', 'kick'] });
  expect(edited.body.role).toMatchObject({ name: 'Moderators', color: null, permissions: ['pin_messages', 'kick'] });
  const temp = (await call('owner', 'POST', `${S}/roles`, { name: 'Temp' })).body.role;
  expect((await call('owner', 'DELETE', `${S}/roles/${temp.id}`)).status).toBe(200);
  expect((await rolesOf()).map((r) => r.name)).toEqual(['Admin', 'Moderators', '@everyone']);

  // @everyone: permissions change, the name doesn't, and it can't be deleted.
  const everyone = await roleNamed('@everyone');
  const ev = await call('owner', 'PATCH', `${S}/roles/${everyone.id}`, { name: 'all', permissions: ['invite', 'pin_messages'] });
  expect(ev.body.role).toMatchObject({ name: '@everyone', permissions: ['invite', 'pin_messages'] });
  expect((await call('owner', 'DELETE', `${S}/roles/${everyone.id}`)).status).toBe(400);
  await call('owner', 'PATCH', `${S}/roles/${everyone.id}`, { permissions: ['invite'] });
});

test('reordering moves roles within the positions they hold', async () => {
  const before = await rolesOf();
  const ids = before.filter((r) => !r.isDefault).map((r) => r.id); // highest first
  expect((await call('owner', 'PUT', `${S}/roles/order`, { ids: [ids[0]] })).status).toBe(400); // must list them all
  const res = await call('owner', 'PUT', `${S}/roles/order`, { ids }); // bottom to top: Admin lowest now
  expect(res.status).toBe(200);
  expect(res.body.roles.map((r) => r.name)).toEqual(['Moderators', 'Admin', '@everyone']);
  await call('owner', 'PUT', `${S}/roles/order`, { ids: [...ids].reverse() });
  expect((await rolesOf()).map((r) => r.name)).toEqual(['Admin', 'Moderators', '@everyone']);
});

test('giving and taking roles; members carry their role ids; abilities follow', async () => {
  const mods = await roleNamed('Moderators');
  const given = await call('owner', 'PUT', `${S}/members/bob/roles/${mods.id}`);
  expect(given).toMatchObject({ status: 200, body: { roles: [mods.id] } });
  const members = (await call('bob', 'GET', `${S}/members`)).body.members;
  expect(members.find((m) => m.username === 'bob').roles).toEqual([mods.id]);
  const bobSpace = (await call('bob', 'GET', '/spaces')).body.find((s) => s.name === SPACE);
  expect(bobSpace.abilities.sort()).toEqual(['invite', 'kick', 'pin_messages']);
  const everyone = await roleNamed('@everyone');
  expect((await call('owner', 'PUT', `${S}/members/bob/roles/${everyone.id}`)).status).toBe(400);
  expect((await call('owner', 'PUT', `${S}/members/nobody/roles/${mods.id}`)).status).toBe(404);
  const taken = await call('owner', 'DELETE', `${S}/members/bob/roles/${mods.id}`);
  expect(taken.body.roles).toEqual([]);
});

test('channel overrides: read, write, and they take effect', async () => {
  await call('owner', 'POST', `${S}/channels`, { name: 'vault' });
  const everyone = await roleNamed('@everyone');
  const mods = await roleNamed('Moderators');
  await call('owner', 'PUT', `${S}/members/bob/roles/${mods.id}`);
  const set = await call('owner', 'PUT', `${S}/channels/vault/overrides`, {
    overrides: [{ roleId: everyone.id, view: 0, post: null }, { roleId: mods.id, view: 1, post: true }],
  });
  expect(set.status).toBe(200);
  expect(set.body.overrides.sort((a, b) => a.roleId - b.roleId)).toEqual([
    { roleId: everyone.id, view: 0, post: null },
    { roleId: mods.id, view: 1, post: 1 },
  ].sort((a, b) => a.roleId - b.roleId));
  expect((await call('bob', 'GET', `${S}/channels/vault/messages`)).status).toBe(200);
  expect((await call('cara', 'GET', `${S}/channels/vault/messages`)).status).toBe(403);
  expect((await call('cara', 'GET', `${S}/channels/vault/overrides`)).status).toBe(403); // not a manager
  expect((await call('owner', 'GET', `${S}/channels/vault/overrides`)).body.overrides).toHaveLength(2);
  expect((await call('owner', 'PUT', `${S}/channels/vault/overrides`, { overrides: [{ roleId: 99999, view: 1 }] })).status).toBe(400);
  expect((await call('owner', 'GET', `${S}/channels/nope/overrides`)).status).toBe(404);
});

test('roles stick: making a channel or a thread leaves role edits alone, and a thread inherits its parent', async () => {
  const admin = await roleNamed('Admin');
  await call('owner', 'PATCH', `${S}/roles/${admin.id}`, { permissions: ['kick'] });
  await call('owner', 'POST', `${S}/channels`, { name: 'another' });
  const msg = db.storeMessage(SPACE, 'vault', 'thread root', users.owner.id);
  const thread = await call('owner', 'POST', `${S}/channels/vault/threads`, { messageId: Number(msg.id), name: 'deep' });
  expect(thread.status).toBe(201);
  expect((await roleNamed('Admin')).permissions).toEqual(['kick']);
  expect((await call('bob', 'GET', '/spaces')).body.find((s) => s.name === SPACE).channels).toContain('vault');
  const channel = thread.body.thread.channel || thread.body.thread.name;
  const threadPath = `${S}/channels/${encodeURIComponent(channel)}/messages`;
  expect((await call('bob', 'GET', threadPath)).status).toBe(200); // Moderators' allow on vault
  expect((await call('cara', 'GET', threadPath)).status).toBe(403);
});

describe('hierarchy for a non-owner with manage_roles', () => {
  let managers;
  beforeAll(async () => {
    // Managers sits between Moderators and Admin and can manage roles and kick.
    managers = db.createRole(spaceId, { name: 'Managers', permissions: ['manage_roles', 'kick', 'pin_messages'] });
    const ids = (await rolesOf()).filter((r) => !r.isDefault).map((r) => r.id).reverse(); // bottom to top
    const admin = (await roleNamed('Admin')).id;
    const order = [...ids.filter((id) => id !== managers.id && id !== admin), managers.id, admin];
    await call('owner', 'PUT', `${S}/roles/order`, { ids: order });
    db.addMemberRole(spaceId, users.mgr.id, managers.id);
  });

  test('manages roles below, not at or above', async () => {
    expect((await rolesOf()).map((r) => r.name)).toEqual(['Admin', 'Managers', 'Moderators', '@everyone']);
    const admin = await roleNamed('Admin');
    const mods = await roleNamed('Moderators');
    expect((await call('mgr', 'PATCH', `${S}/roles/${admin.id}`, { name: 'Boss' })).status).toBe(403);
    expect((await call('mgr', 'PATCH', `${S}/roles/${managers.id}`, { name: 'Me' })).status).toBe(403); // own top role
    expect((await call('mgr', 'DELETE', `${S}/roles/${admin.id}`)).status).toBe(403);
    expect((await call('mgr', 'PATCH', `${S}/roles/${mods.id}`, { color: '#00aa00' })).status).toBe(200);
    // A new role lands at the bottom, below the manager.
    const made = await call('mgr', 'POST', `${S}/roles`, { name: 'Helpers', permissions: ['pin_messages'] });
    expect(made.status).toBe(201);
    expect((await rolesOf()).map((r) => r.name)).toEqual(['Admin', 'Managers', 'Moderators', 'Helpers', '@everyone']);
  });

  test("can't grant or remove permissions they don't hold", async () => {
    expect((await call('mgr', 'POST', `${S}/roles`, { name: 'Sneaky', permissions: ['edit_server'] })).status).toBe(403);
    const mods = await roleNamed('Moderators');
    expect((await call('mgr', 'PATCH', `${S}/roles/${mods.id}`, { permissions: [...mods.permissions, 'delete_channel'] })).status).toBe(403);
    expect((await call('mgr', 'PATCH', `${S}/roles/${mods.id}`, { permissions: ['kick'] })).status).toBe(200); // pin_messages off: held
  });

  test('reorders only the roles below them', async () => {
    const admin = await roleNamed('Admin');
    const mine = (await rolesOf()).filter((r) => !r.isDefault && r.id !== admin.id && r.id !== managers.id).map((r) => r.id);
    expect((await call('mgr', 'PUT', `${S}/roles/order`, { ids: [...mine, admin.id] })).status).toBe(400);
    expect((await call('mgr', 'PUT', `${S}/roles/order`, { ids: mine })).status).toBe(200); // Moderators to the bottom
    expect((await rolesOf()).map((r) => r.name)).toEqual(['Admin', 'Managers', 'Helpers', 'Moderators', '@everyone']);
  });

  test('gives and takes only roles below them, and only for members below them or themselves', async () => {
    const admin = await roleNamed('Admin');
    const helpers = await roleNamed('Helpers');
    expect((await call('mgr', 'PUT', `${S}/members/cara/roles/${admin.id}`)).status).toBe(403);
    expect((await call('mgr', 'PUT', `${S}/members/cara/roles/${helpers.id}`)).status).toBe(200);
    expect((await call('mgr', 'PUT', `${S}/members/mgr/roles/${helpers.id}`)).status).toBe(200); // themselves
    db.setMemberRole(spaceId, users.cara.id, 'admin'); // cara now sits above
    expect((await call('mgr', 'DELETE', `${S}/members/cara/roles/${helpers.id}`)).status).toBe(403);
    expect((await call('mgr', 'DELETE', `${S}/members/owner/roles/${helpers.id}`)).status).toBe(403);
    db.setMemberRole(spaceId, users.cara.id, 'member');
  });

  test('channel overrides need the manager right and respect the hierarchy', async () => {
    const admin = await roleNamed('Admin');
    const everyone = await roleNamed('@everyone');
    expect((await call('mgr', 'GET', `${S}/channels/general/overrides`)).status).toBe(403); // no edit_server
    await call('owner', 'PATCH', `${S}/roles/${managers.id}`, { permissions: [...managers.permissions, 'edit_server'] });
    expect((await call('mgr', 'GET', `${S}/channels/general/overrides`)).status).toBe(200);
    expect((await call('mgr', 'PUT', `${S}/channels/general/overrides`, { overrides: [{ roleId: admin.id, view: 0 }] })).status).toBe(403);
    expect((await call('mgr', 'PUT', `${S}/channels/general/overrides`, { overrides: [{ roleId: everyone.id, post: 0 }] })).status).toBe(200);
    expect((await call('cara', 'GET', '/spaces')).body.find((s) => s.name === SPACE).channelMeta.general.canPost).toBe(false);
  });

  // P3-18: channelMeta's private / readOnly flags follow @everyone's override.
  test('channelMeta marks private and read-only channels from the overrides', async () => {
    const everyone = await roleNamed('@everyone');
    const admin = await roleNamed('Admin');
    const metaFor = async (who, channel) => (await call(who, 'GET', '/spaces')).body.find((s) => s.name === SPACE).channelMeta[channel];
    await call('owner', 'POST', `${S}/channels`, { name: 'lockbox' });
    expect(await metaFor('owner', 'lockbox')).toMatchObject({ private: false, readOnly: false });

    await call('owner', 'PUT', `${S}/channels/lockbox/overrides`, { overrides: [{ roleId: everyone.id, post: 0 }] });
    expect(await metaFor('cara', 'lockbox')).toMatchObject({ private: false, readOnly: true, canPost: false });

    // Hidden from @everyone, shown to Admin: the owner and an admin see it as private.
    await call('owner', 'PUT', `${S}/channels/lockbox/overrides`, { overrides: [{ roleId: everyone.id, view: 0 }, { roleId: admin.id, view: 1 }] });
    expect(await metaFor('owner', 'lockbox')).toMatchObject({ private: true, readOnly: false });
    expect(await metaFor('cara', 'lockbox')).toBeUndefined();
    db.setMemberRole(spaceId, users.cara.id, 'admin');
    expect(await metaFor('cara', 'lockbox')).toMatchObject({ private: true, readOnly: false });
    db.setMemberRole(spaceId, users.cara.id, 'member');

    // The legacy tier columns alone don't make a channel private.
    db.raw.prepare("UPDATE channels SET view_role = 3, post_role = 3 WHERE name = 'general' AND space_id = ?").run(spaceId);
    await call('owner', 'PUT', `${S}/channels/general/overrides`, { overrides: [{ roleId: everyone.id, view: null, post: null }] });
    expect(await metaFor('owner', 'general')).toMatchObject({ view: 3, post: 3, private: false, readOnly: false });
  });
});
