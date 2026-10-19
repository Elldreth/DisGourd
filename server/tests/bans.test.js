// P3-26b: banning — rank rules, the message clean-up windows, invites refused,
// the Bans list, unban, the log entries and the `banned` frame.
const WebSocket = require('ws');
const os = require('os');
const path = require('path');

let serverModule;
let port;
const SPACE = 'Banland';

beforeAll((done) => {
  process.env.PORT = 0;
  process.env.JWT_SECRET = 'disgourd-test-secret-0123456789abcdef';
  process.env.DB_PATH = ':memory:';
  process.env.UPLOADS_DIR = path.join(os.tmpdir(), `disgourd-test-uploads-bans-${process.pid}`);
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
  const frames = [];
  ws.on('message', (raw) => frames.push(JSON.parse(raw.toString())));
  const ready = new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });
  return { frames, ready, close: () => ws.close() };
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
const spaceId = () => serverModule.db.getSpaceByName(SPACE).id;
const isMember = (name) => serverModule.db.isMember(spaceId(), users[name].id);
const invite = async () => (await call('owner', 'POST', `${S}/invites`)).body.code;

beforeAll(async () => {
  const { db } = serverModule;
  for (const name of ['owner', 'admin', 'admin2', 'member', 'member2', 'member3']) {
    const token = await register(name);
    users[name] = { token, id: db.getUserByUsername(name).id };
  }
  const id = db.createSpaceWithDefaults(SPACE, users.owner.id);
  db.addMember(id, users.admin.id, 'admin');
  db.addMember(id, users.admin2.id, 'admin');
  for (const n of ['member', 'member2', 'member3']) db.addMember(id, users[n].id, 'member');
  for (const name of ['owner', 'member']) {
    users[name].gw = gateway(users[name].token);
    await users[name].gw.ready;
  }
  await wait(100);
});

test('admins get "Ban members" by default; members do not', async () => {
  expect((await call('member', 'GET', `${S}/bans`)).status).toBe(403);
  expect((await call('admin', 'GET', `${S}/bans`)).body).toEqual({ bans: [] });
  expect((await call('member', 'POST', `${S}/bans`, { user: 'member2' })).status).toBe(403);
});

test('rank rules: not yourself, not someone at or above you, never the owner', async () => {
  expect((await call('admin', 'POST', `${S}/bans`, { user: 'admin' })).status).toBe(400);
  expect((await call('admin', 'POST', `${S}/bans`, { user: 'admin2' })).status).toBe(403);
  expect((await call('admin', 'POST', `${S}/bans`, { user: 'owner' })).status).toBe(403);
  expect((await call('admin', 'POST', `${S}/bans`, { user: 'nobody' })).status).toBe(404);
  expect((await call('admin', 'POST', `${S}/bans`, { user: 'member2', deleteMessages: 'forever' })).status).toBe(400);
  expect(isMember('member2')).toBe(true);
});

test('a ban removes them, deletes their messages in the window, tells them, and is logged', async () => {
  const { db } = serverModule;
  const fresh = db.storeMessage(SPACE, 'general', 'just now', users.member.id).id;
  const old = db.storeMessage(SPACE, 'general', 'two hours ago', users.member.id).id;
  // Age the second message past the one-hour window.
  db.raw.prepare('UPDATE messages SET created_at = ? WHERE id = ?').run(Date.now() - 2 * 3600e3, old);
  const other = db.storeMessage(SPACE, 'general', 'someone else', users.member3.id).id;

  const res = await call('admin', 'POST', `${S}/bans`, { user: 'member', reason: '  spamming links  ', deleteMessages: 'hour' });
  expect(res.status).toBe(200);
  expect(isMember('member')).toBe(false);
  expect(db.getMessageLocation(fresh)).toBeUndefined();
  expect(db.getMessageLocation(old)).toBeTruthy();
  expect(db.getMessageLocation(other)).toBeTruthy();
  await wait(150);
  expect(users.member.gw.frames).toContainEqual({ type: 'banned', space: SPACE, reason: 'spamming links' });
  expect(users.owner.gw.frames.some((f) => f.type === 'message_delete' && Number(f.id) === Number(fresh))).toBe(true);
  expect(users.owner.gw.frames.some((f) => f.type === 'members_changed' && f.space === SPACE)).toBe(true);

  const entry = db.getModLog(spaceId(), { action: 'ban' }).entries[0];
  expect(entry).toMatchObject({ actor: 'admin', target: 'member', reason: 'spamming links', details: { deleteMessages: 'hour' } });
  const bans = (await call('admin', 'GET', `${S}/bans`)).body.bans;
  expect(bans).toEqual([expect.objectContaining({ username: 'member', by: 'admin', reason: 'spamming links' })]);
});

test('a banned person is refused by every invite, and the preview says so', async () => {
  const code = await invite();
  expect((await call('member', 'GET', `/invites/${code}`)).body).toMatchObject({ banned: true, alreadyMember: false });
  const join = await call('member', 'POST', `/invites/${code}`);
  expect(join.status).toBe(403);
  expect(join.body.error).toBe("You're banned from this server");
  expect(isMember('member')).toBe(false);
  // The refused join doesn't use up the invite.
  expect(serverModule.db.getInvite(code).uses).toBe(0);
});

test('deleteMessages "week" reaches a week back; "none" deletes nothing', async () => {
  const { db } = serverModule;
  const a = db.storeMessage(SPACE, 'general', 'a', users.member2.id).id;
  await call('owner', 'POST', `${S}/bans`, { user: 'member2', deleteMessages: 'week' });
  expect(db.getMessageLocation(a)).toBeUndefined();
  const b = db.storeMessage(SPACE, 'general', 'b', users.member3.id).id;
  const res = await call('owner', 'POST', `${S}/bans`, { user: 'member3' });
  expect(res.body).toEqual({ ok: true, deleted: 0 });
  expect(db.getMessageLocation(b)).toBeTruthy();
});

test('unban: logged, they are not re-added, and they can join again', async () => {
  expect((await call('member', 'DELETE', `${S}/bans/member`)).status).toBe(403);
  expect((await call('admin', 'DELETE', `${S}/bans/member`)).status).toBe(200);
  expect((await call('admin', 'DELETE', `${S}/bans/member`)).status).toBe(404);
  expect(isMember('member')).toBe(false);
  expect(serverModule.db.getModLog(spaceId(), { action: 'unban' }).entries[0]).toMatchObject({ actor: 'admin', target: 'member' });
  expect((await call('member', 'POST', `/invites/${await invite()}`)).status).toBe(200);
  expect(isMember('member')).toBe(true);
});

test('the owner can turn "Ban members" off for Admin on the roles screen', async () => {
  const { db } = serverModule;
  const adminRole = db.getRoles(spaceId()).find((r) => r.name === 'Admin');
  expect(adminRole.permissions).toContain('ban_members');
  db.updateRole(spaceId(), adminRole.id, { permissions: adminRole.permissions.filter((p) => p !== 'ban_members') });
  expect((await call('admin', 'GET', `${S}/bans`)).status).toBe(403);
});
