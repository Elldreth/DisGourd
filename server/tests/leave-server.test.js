// P6-01: leave a server — members (not the owner) remove themselves; their
// roles, read markers and thread follows there go too; everyone hears about it.
const WebSocket = require('ws');
const os = require('os');
const path = require('path');

let serverModule;
let port;
const SPACE = 'Leaveland';

beforeAll((done) => {
  process.env.PORT = 0;
  process.env.JWT_SECRET = 'disgourd-test-secret-0123456789abcdef';
  process.env.DB_PATH = ':memory:';
  process.env.UPLOADS_DIR = path.join(os.tmpdir(), `disgourd-test-uploads-leave-${process.pid}`);
  serverModule = require('../server');
  serverModule.httpServer.listen(0, () => {
    port = serverModule.httpServer.address().port;
    done();
  });
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const users = {}; // name -> { token, id, gws: [] }

afterAll((done) => {
  for (const u of Object.values(users)) for (const gw of u.gws) gw.close();
  serverModule.httpServer.close(done);
});

async function register(username) {
  const res = await fetch(`http://localhost:${port}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'gourd-test-pass-1', email: `${username}@example.com` }),
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
    headers: { 'content-type': 'application/json', ...(who ? { Authorization: `Bearer ${users[who].token}` } : {}) },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const S = `/spaces/${SPACE}`;
const leave = (who) => call(who, 'DELETE', `${S}/members/me`);
const raw = () => serverModule.db.raw;

beforeAll(async () => {
  const { db } = serverModule;
  for (const name of ['owner', 'member', 'other', 'outsider']) {
    const token = await register(name);
    users[name] = { token, id: db.getUserByUsername(name).id, gws: [] };
  }
  const id = db.createSpaceWithDefaults(SPACE, users.owner.id);
  db.addMember(id, users.member.id, 'member');
  db.addMember(id, users.other.id, 'member');
  // Two tabs for the member, one each for the others.
  for (const name of ['owner', 'member', 'member', 'other']) {
    const gw = gateway(users[name].token);
    users[name].gws.push(gw);
    await gw.ready;
  }
  await wait(100);
});

test('without a token, as a non-member, and as the owner, leaving is refused', async () => {
  expect((await leave(null)).status).toBe(401);
  expect((await leave('outsider')).status).toBe(403);
  const res = await leave('owner');
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/owner can't leave/i);
  expect(serverModule.db.isMember(serverModule.db.getSpaceByName(SPACE).id, users.owner.id)).toBe(true);
});

test('a member leaves: membership, roles, read markers and thread follows go; others stay', async () => {
  const { db } = serverModule;
  const spaceId = db.getSpaceByName(SPACE).id;
  const role = db.createRole(spaceId, { name: 'Helpers' });
  db.addMemberRole(spaceId, users.member.id, role.id);
  db.addMemberRole(spaceId, users.other.id, role.id);
  db.markRead(users.member.id, SPACE, 'general', 1);
  db.markRead(users.other.id, SPACE, 'general', 1);
  const general = raw().prepare("SELECT id FROM channels WHERE space_id = ? AND name = 'general'").get(spaceId).id;
  db.followThread(users.member.id, general);
  db.followThread(users.other.id, general);
  for (const u of Object.values(users)) for (const gw of u.gws) gw.frames.length = 0;

  expect(await leave('member')).toEqual({ status: 200, body: { ok: true } });
  await wait(150);

  // Gone from the member list and from their own server list.
  const members = (await call('owner', 'GET', `${S}/members`)).body;
  const names = (Array.isArray(members) ? members : members.members).map((m) => m.username);
  expect(names).not.toContain('member');
  expect(names).toContain('other');
  expect((await call('member', 'GET', '/spaces')).body.map((s) => s.name)).not.toContain(SPACE);
  expect((await call('member', 'GET', `${S}/members`)).status).toBe(403);

  // Their rows went; the other member's stayed.
  expect(db.getMemberRoleIds(spaceId, users.member.id)).toEqual([]);
  expect(db.getMemberRoleIds(spaceId, users.other.id)).toContain(role.id);
  const readRows = (uid) => raw().prepare('SELECT COUNT(*) AS n FROM read_state WHERE user_id = ? AND space = ?').get(uid, SPACE).n;
  expect(readRows(users.member.id)).toBe(0);
  expect(readRows(users.other.id)).toBe(1);
  expect(db.isFollowingThread(users.member.id, general)).toBeFalsy();
  expect(db.isFollowingThread(users.other.id, general)).toBeTruthy();

  // Remaining members get members_changed; both of the leaver's tabs get space_left.
  for (const name of ['owner', 'other']) {
    expect(users[name].gws[0].frames.some((f) => f.type === 'members_changed' && f.space === SPACE)).toBe(true);
  }
  for (const gw of users.member.gws) {
    expect(gw.frames.some((f) => f.type === 'space_left' && f.space === SPACE)).toBe(true);
  }
  // Leaving isn't a moderation action: nothing in the mod log.
  expect(db.getModLog(spaceId, {}).entries).toHaveLength(0);
});

test('leaving again (no longer a member) is refused', async () => {
  expect((await leave('member')).status).toBe(403);
});
