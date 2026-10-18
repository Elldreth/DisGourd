// P2-21a: the roles tables are seeded from the fixed tiers, kept in step as
// tiers change, and a resolver over them agrees with every check in use today.
const os = require('os');
const path = require('path');

let serverModule;
let db;
let perms;
const users = {};
const SPACE = 'Roles Fixture';
const ACTIONS = ['create_channel', 'delete_channel', 'invite', 'kick', 'edit_server', 'delete_others_messages', 'pin_messages', 'manage_emoji', 'manage_roles'];
const CHANNELS = [['open', 1, 1], ['announce', 1, 2], ['staff', 2, 2], ['admin-post', 2, 3], ['owners', 3, 3]];

beforeAll((done) => {
  process.env.PORT = 0;
  process.env.JWT_SECRET = 'disgourd-test-secret-0123456789abcdef';
  process.env.DB_PATH = ':memory:';
  process.env.UPLOADS_DIR = path.join(os.tmpdir(), `disgourd-test-uploads-roles-${process.pid}`);
  serverModule = require('../server');
  db = serverModule.db;
  perms = require('../permissions');
  serverModule.httpServer.listen(0, done);
});
afterAll((done) => {
  serverModule.httpServer.close(done);
});

let spaceId;
beforeAll(() => {
  for (const name of ['owner', 'adm1', 'adm2', 'mem1', 'mem2', 'mem3', 'outsider']) {
    users[name] = db.createUser(name, `${name}@example.com`, 'hash', 'salt');
  }
  spaceId = db.createSpaceWithDefaults(SPACE, users.owner);
  db.addMember(spaceId, users.adm1, 'admin');
  db.addMember(spaceId, users.adm2, 'admin');
  for (const m of ['mem1', 'mem2', 'mem3']) db.addMember(spaceId, users[m], 'member');
  for (const [name, v, p] of CHANNELS) {
    db.createChannel(SPACE, name);
    db.setChannelPerms(SPACE, name, v, p);
  }
  db.setSpacePermissions(spaceId, { invite: 2, pin_messages: 1, kick: 3, manage_emoji: 1 });
});

const members = () => ['owner', 'adm1', 'adm2', 'mem1', 'mem2', 'mem3'];
// The old tier maths for a channel gate (what canViewChannel / canPostChannel did before P2-21b).
const tierView = (name, role) => db.roleRank(role) >= (db.getChannelPerms(SPACE, name)?.view || 1);
const tierPost = (name, role) => db.roleRank(role) >= (db.getChannelPerms(SPACE, name)?.post || 1);
const channelId = (name) => db.raw.prepare('SELECT id FROM channels WHERE space_id = ? AND name = ?').get(spaceId, name).id;

// The resolver must agree with the old checks for everyone, everywhere
// (`skip`: members holding custom roles, which the old checks can't know).
function expectAgreement(label, skip = []) {
  for (const who of members().filter((m) => !skip.includes(m))) {
    const role = db.getMemberRole(spaceId, users[who]);
    const r = perms.resolvePermissions(spaceId, users[who]);
    expect(r).not.toBeNull();
    for (const action of ACTIONS) {
      expect([label, who, action, r.actions.has(action)]).toEqual([label, who, action, db.canDo(spaceId, role, action)]);
    }
    for (const [name] of CHANNELS.concat([['general', 1, 1]])) {
      const c = perms.resolvePermissions(spaceId, users[who], channelId(name));
      expect([label, who, name, c.view, c.post]).toEqual([label, who, name, tierView(name, role), tierPost(name, role)]);
    }
  }
  // Rank order (for kick / moderation): the same strict ordering as roleRank.
  for (const a of members().filter((m) => !skip.includes(m))) {
    for (const b of members().filter((m) => !skip.includes(m))) {
      const old = db.roleRank(db.getMemberRole(spaceId, users[b])) < db.roleRank(db.getMemberRole(spaceId, users[a]));
      const now = perms.resolvePermissions(spaceId, users[b]).position < perms.resolvePermissions(spaceId, users[a]).position;
      expect([label, a, b, now]).toEqual([label, a, b, old]);
    }
  }
}

test('the seeded roles, memberships and overrides mirror the tiers', () => {
  const roles = db.getRoles(spaceId);
  expect(roles.map((r) => [r.name, r.position, r.isDefault])).toEqual([['@everyone', 0, true], ['Admin', 1, false]]);
  const everyone = roles.find((r) => r.isDefault);
  const admin = roles.find((r) => r.name === 'Admin');
  expect(everyone.permissions.sort()).toEqual(['manage_emoji', 'pin_messages']); // thresholds of 1 in the fixture
  expect(admin.permissions.sort()).toEqual(['create_channel', 'delete_channel', 'delete_others_messages', 'edit_server', 'invite', 'manage_emoji', 'pin_messages']); // up to 2; kick is 3
  expect(db.getMemberRoleIds(spaceId, users.adm1)).toEqual([admin.id]);
  expect(db.getMemberRoleIds(spaceId, users.mem1)).toEqual([]);
  const ov = (name, roleId) => db.getChannelOverrides(channelId(name)).find((o) => o.roleId === roleId) || null;
  expect(ov('open', everyone.id)).toBeNull();
  expect(ov('announce', everyone.id)).toMatchObject({ view: null, post: 0 });
  expect(ov('announce', admin.id)).toMatchObject({ view: null, post: 1 });
  expect(ov('staff', everyone.id)).toMatchObject({ view: 0, post: 0 });
  expect(ov('staff', admin.id)).toMatchObject({ view: 1, post: 1 });
  expect(ov('owners', everyone.id)).toMatchObject({ view: 0, post: 0 });
  expect(ov('owners', admin.id)).toMatchObject({ view: 0, post: 0 });
});

test('the resolver agrees with the old checks for every member, action and channel', () => {
  expectAgreement('fixture');
  expect(perms.resolvePermissions(spaceId, users.outsider)).toBeNull();
  const owner = perms.resolvePermissions(spaceId, users.owner, channelId('owners'));
  expect(owner).toMatchObject({ owner: true, view: true, post: true, position: Infinity });
  expect(ACTIONS.every((a) => owner.actions.has(a))).toBe(true);
});

test('it keeps agreeing as tiers, permissions, channel access and threads change', () => {
  db.setMemberRole(spaceId, users.mem1, 'admin');
  expectAgreement('promoted mem1');
  db.setMemberRole(spaceId, users.adm2, 'member');
  expectAgreement('demoted adm2');
  db.setSpacePermissions(spaceId, { invite: 1, pin_messages: 2, kick: 2, manage_emoji: 2 });
  expectAgreement('permissions changed');
  db.setChannelPerms(SPACE, 'open', 2, 3);
  CHANNELS[0] = ['open', 2, 3];
  expectAgreement('open made private');
  const root = db.storeMessage(SPACE, 'staff', 'root', users.owner).id;
  const { thread } = db.createThread(SPACE, 'staff', root, 'Private thread', users.owner);
  const t = perms.resolvePermissions(spaceId, users.mem2, thread.id);
  expect([t.view, t.post]).toEqual([tierView(thread.channel, 'member'), tierPost(thread.channel, 'member')]);
  expect(t.view).toBe(false);
  db.setChannelPerms(SPACE, 'staff', 1, 1); // the thread follows its parent
  const t2 = perms.resolvePermissions(spaceId, users.mem2, thread.id);
  expect([t2.view, t2.post]).toEqual([true, true]);
  CHANNELS[2] = ['staff', 1, 1];
  expectAgreement('staff opened');
});

test('a custom role works through the resolver: its own actions and a channel allow', () => {
  const mods = db.createRole(spaceId, { name: 'Mods', color: '#ff8800', permissions: ['pin_messages', 'delete_others_messages'] });
  expect(mods).toMatchObject({ name: 'Mods', position: 2, color: '#ff8800' });
  db.addMemberRole(spaceId, users.mem3, mods.id);
  const r = perms.resolvePermissions(spaceId, users.mem3);
  expect(r.actions.has('delete_others_messages')).toBe(true);
  expect(r.actions.has('create_channel')).toBe(false);
  expect(r.position).toBe(2); // above Admin (1): positions order roles, not the old tiers
  expect(perms.resolvePermissions(spaceId, users.mem3, channelId('owners')).view).toBe(false);
  db.setChannelOverride(channelId('owners'), mods.id, { view: 1, post: null });
  const c = perms.resolvePermissions(spaceId, users.mem3, channelId('owners'));
  expect([c.view, c.post]).toEqual([true, false]); // allowed in, still can't post (everyone's deny stands)
  // A role deny loses to another role's allow; a lone deny wins over inherit.
  const quiet = db.createRole(spaceId, { name: 'Quiet', permissions: [] });
  db.addMemberRole(spaceId, users.mem3, quiet.id);
  db.setChannelOverride(channelId('owners'), quiet.id, { view: 0, post: null });
  expect(perms.resolvePermissions(spaceId, users.mem3, channelId('owners')).view).toBe(true);
  db.setChannelOverride(channelId('general'), quiet.id, { view: null, post: 0 });
  expect(perms.resolvePermissions(spaceId, users.mem3, channelId('general')).post).toBe(false);
  // The tier sync leaves custom roles alone.
  db.setSpacePermissions(spaceId, { invite: 2 });
  expect(db.getRoles(spaceId).map((x) => x.name)).toEqual(['@everyone', 'Admin', 'Mods', 'Quiet']);
  expect(db.getMemberRoleIds(spaceId, users.mem3).sort()).toEqual([mods.id, quiet.id].sort());
  db.removeMemberRole(spaceId, users.mem3, quiet.id);
  db.deleteRole(spaceId, quiet.id);
  expect(db.getRoles(spaceId).map((x) => x.name)).toEqual(['@everyone', 'Admin', 'Mods']);
});

test('seeding all servers rebuilds the tier roles (what the migration does for existing servers)', () => {
  const before = db.getRoles(spaceId).map((r) => r.name);
  db.raw.prepare("DELETE FROM roles WHERE space_id = ? AND name IN ('@everyone', 'Admin')").run(spaceId);
  expect(db.getRoles(spaceId).map((r) => r.name)).toEqual(before.filter((n) => n !== '@everyone' && n !== 'Admin'));
  db.seedAllSpaceRoles();
  expect(db.getRoles(spaceId).map((r) => r.name)).toEqual(before);
  expectAgreement('after reseeding', ['mem3']); // mem3 holds the custom Mods role
});

test('rows go with the member and the server', () => {
  const count = (sql, ...a) => db.raw.prepare(sql).get(...a).n;
  expect(count('SELECT COUNT(*) AS n FROM member_roles WHERE user_id = ?', users.mem3)).toBe(1);
  db.removeMember(spaceId, users.mem3);
  expect(count('SELECT COUNT(*) AS n FROM member_roles WHERE user_id = ?', users.mem3)).toBe(0);
  const other = db.createSpaceWithDefaults('Short Lived', users.owner);
  expect(db.getRoles(other).map((r) => r.name)).toEqual(['@everyone', 'Admin']);
  db.deleteSpace('Short Lived');
  expect(count('SELECT COUNT(*) AS n FROM roles WHERE space_id = ?', other)).toBe(0);
  expect(count('SELECT COUNT(*) AS n FROM channel_role_overrides o JOIN roles r ON r.id = o.role_id WHERE r.space_id = ?', other)).toBe(0);
});
