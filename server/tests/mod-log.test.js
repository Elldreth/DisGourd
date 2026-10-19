// P3-26a: the moderation log — entries for deletes by others, kicks, role
// changes and access changes, and the paged, filtered, permission-gated GET.
const WebSocket = require('ws');
const os = require('os');
const path = require('path');

let serverModule;
let port;
const SPACE = 'Logland';

beforeAll((done) => {
  process.env.PORT = 0;
  process.env.JWT_SECRET = 'disgourd-test-secret-0123456789abcdef';
  process.env.DB_PATH = ':memory:';
  process.env.UPLOADS_DIR = path.join(os.tmpdir(), `disgourd-test-uploads-modlog-${process.pid}`);
  serverModule = require('../server');
  serverModule.httpServer.listen(0, () => {
    port = serverModule.httpServer.address().port;
    done();
  });
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const users = {}; // name -> { token, id, gw }

afterAll((done) => {
  for (const u of Object.values(users)) u.gw?.close();
  serverModule.httpServer.close(done);
});

async function register(username) {
  const res = await fetch(`http://localhost:${port}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'password123', email: `${username}@example.com` }),
  });
  return (await res.json()).token;
}

function gateway(token) {
  const ws = new WebSocket(`ws://localhost:${port}/gateway?token=${token}`);
  const ready = new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });
  return { ready, send: (obj) => ws.send(JSON.stringify(obj)), close: () => ws.close() };
}

const call = async (who, method, p, body) => {
  const res = await fetch(`http://localhost:${port}${p}`, {
    method,
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${users[who].token}` },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const S = `/spaces/${SPACE}`;
const log = async (who = 'owner', query = '') => call(who, 'GET', `${S}/mod-log${query}`);
const spaceId = () => serverModule.db.getSpaceByName(SPACE).id;

beforeAll(async () => {
  const { db } = serverModule;
  for (const name of ['owner', 'admin', 'member', 'member2']) {
    const token = await register(name);
    users[name] = { token, id: db.getUserByUsername(name).id };
  }
  const id = db.createSpaceWithDefaults(SPACE, users.owner.id);
  db.addMember(id, users.admin.id, 'admin');
  db.addMember(id, users.member.id, 'member');
  db.addMember(id, users.member2.id, 'member');
  for (const name of ['owner', 'admin', 'member']) {
    users[name].gw = gateway(users[name].token);
    await users[name].gw.ready;
  }
  await wait(100);
});

async function deleteAs(actor, messageId) {
  users[actor].gw.send({ op: 'delete', id: messageId });
  await wait(120);
}

test("deleting someone else's message is logged with the channel and an excerpt", async () => {
  const long = `spam ${'x'.repeat(200)}`;
  const id = serverModule.db.storeMessage(SPACE, 'general', long, users.member.id).id;
  await deleteAs('admin', id);
  const { status, body } = await log();
  expect(status).toBe(200);
  const e = body.entries[0];
  expect(e).toMatchObject({ action: 'message_delete', actor: 'admin', target: 'member', reason: null });
  expect(e.details.channel).toBe('general');
  expect(e.details.excerpt.length).toBe(100);
  expect(e.details.excerpt.startsWith('spam xx')).toBe(true);
  expect(typeof e.createdAt).toBe('number');
});

test('deleting your own message is not logged', async () => {
  const before = (await log()).body.entries.length;
  const id = serverModule.db.storeMessage(SPACE, 'general', 'typo', users.member.id).id;
  await deleteAs('member', id);
  expect(serverModule.db.getMessageLocation(id)).toBeUndefined();
  expect((await log()).body.entries.length).toBe(before);
});

test('a kick is logged', async () => {
  expect((await call('admin', 'DELETE', `${S}/members/member2`)).status).toBe(200);
  expect((await log()).body.entries[0]).toMatchObject({ action: 'kick', actor: 'admin', target: 'member2' });
});

test('giving and taking a role is logged with the role name', async () => {
  const { db } = serverModule;
  const role = db.createRoleAtBottom(spaceId(), { name: 'Helpers', color: null, permissions: [] });
  expect((await call('owner', 'PUT', `${S}/members/member/roles/${role.id}`)).status).toBe(200);
  expect((await call('owner', 'DELETE', `${S}/members/member/roles/${role.id}`)).status).toBe(200);
  const [removed, added] = (await log()).body.entries;
  expect(added).toMatchObject({ action: 'role_add', actor: 'owner', target: 'member', details: { role: 'Helpers' } });
  expect(removed).toMatchObject({ action: 'role_remove', details: { role: 'Helpers' } });
  // Giving a role someone already has changes nothing, so it isn't logged.
  const count = (await log()).body.entries.length;
  await call('owner', 'DELETE', `${S}/members/member/roles/${role.id}`);
  expect((await log()).body.entries.length).toBe(count);
});

test('channel and category access changes are logged with the roles changed', async () => {
  const { db } = serverModule;
  const everyone = db.getRoles(spaceId()).find((r) => r.isDefault);
  db.createChannel(SPACE, 'staff');
  expect((await call('owner', 'PUT', `${S}/channels/staff/overrides`, { overrides: [{ roleId: everyone.id, view: false, post: null }] })).status).toBe(200);
  expect((await log()).body.entries[0]).toMatchObject({
    action: 'channel_access', actor: 'owner', target: null,
    details: { channel: 'staff', roles: [{ role: everyone.name, view: false, post: null }] },
  });
  const cat = db.createCategory(spaceId(), 'Staff area');
  const catId = typeof cat === 'object' ? cat.id : cat;
  expect((await call('owner', 'PUT', `${S}/categories/${catId}/overrides`, { overrides: [{ roleId: everyone.id, view: true, post: false }] })).status).toBe(200);
  expect((await log()).body.entries[0]).toMatchObject({
    action: 'category_access', details: { category: 'Staff area', roles: [{ role: everyone.name, view: true, post: false }] },
  });
});

test('only people with a moderation permission can read the log', async () => {
  expect((await log('member')).status).toBe(403);
  expect((await log('admin')).status).toBe(200);
  // A member given just "Remove members" can read it.
  const { db } = serverModule;
  const role = db.createRoleAtBottom(spaceId(), { name: 'Bouncers', color: null, permissions: ['kick'] });
  db.addMemberRole(spaceId(), users.member.id, role.id);
  expect((await log('member')).status).toBe(200);
  db.removeMemberRole(spaceId(), users.member.id, role.id);
});

test('filters by action and by person, and pages 50 at a time', async () => {
  const { db } = serverModule;
  const kicks = (await log('owner', '?action=kick')).body.entries;
  expect(kicks.length).toBe(1);
  expect(kicks.every((e) => e.action === 'kick')).toBe(true);
  const aboutMember2 = (await log('owner', '?user=member2')).body.entries;
  expect(aboutMember2.map((e) => e.action)).toEqual(['kick']);
  expect((await log('owner', '?user=nobody')).body).toEqual({ entries: [], more: false });

  for (let i = 0; i < 60; i++) db.logModAction(spaceId(), { actorId: users.owner.id, targetId: users.admin.id, action: 'test', reason: `r${i}` });
  const first = (await log('owner', '?action=test')).body;
  expect(first.entries.length).toBe(50);
  expect(first.more).toBe(true);
  expect(first.entries[0].reason).toBe('r59');
  const next = (await log('owner', `?action=test&before=${first.entries[49].id}`)).body;
  expect(next.entries.length).toBe(10);
  expect(next.more).toBe(false);
  expect(next.entries[9].reason).toBe('r0');
});

test("entries go when the server is deleted", async () => {
  const { db } = serverModule;
  const id = spaceId();
  expect(db.getModLog(id).entries.length).toBeGreaterThan(0);
  db.deleteSpace(SPACE);
  expect(db.getModLog(id).entries).toEqual([]);
});
