// P3-26c: timeouts — set / remove with rank rules, every guarded path refused
// while active and allowed after, the log, and voice (forced mute; and calls
// ended by a ban or removal).
const WebSocket = require('ws');
const os = require('os');
const path = require('path');

let serverModule;
let port;
const SPACE = 'Hushland';

beforeAll((done) => {
  process.env.PORT = 0;
  process.env.JWT_SECRET = 'disgourd-test-secret-0123456789abcdef';
  process.env.DB_PATH = ':memory:';
  process.env.UPLOADS_DIR = path.join(os.tmpdir(), `disgourd-test-uploads-timeouts-${process.pid}`);
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
  return { frames, ready, send: (o) => ws.send(JSON.stringify(o)), close: () => ws.close() };
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
const timeOut = (who, target, body = { minutes: 5 }) => call(who, 'PUT', `${S}/members/${target}/timeout`, body);
// End a timeout "in the past", as if the clock had moved on.
const expire = (name) => serverModule.db.setMemberTimeout(spaceId(), users[name].id, Date.now() - 1000, 'old');
const last = (name, type) => [...users[name].gw.frames].reverse().find((f) => f.type === type);

beforeAll(async () => {
  const { db } = serverModule;
  for (const name of ['owner', 'admin', 'admin2', 'member', 'member2']) {
    const token = await register(name);
    users[name] = { token, id: db.getUserByUsername(name).id };
  }
  const id = db.createSpaceWithDefaults(SPACE, users.owner.id);
  db.addMember(id, users.admin.id, 'admin');
  db.addMember(id, users.admin2.id, 'admin');
  db.addMember(id, users.member.id, 'member');
  db.addMember(id, users.member2.id, 'member');
  db.createChannel(SPACE, 'lounge', 'voice');
  for (const name of ['owner', 'admin', 'member', 'member2']) {
    users[name].gw = gateway(users[name].token);
    await users[name].gw.ready;
  }
  await wait(100);
});

test('permission and rank rules; bad durations refused', async () => {
  expect((await timeOut('member', 'member2')).status).toBe(403);
  expect((await timeOut('admin', 'admin')).status).toBe(400);
  expect((await timeOut('admin', 'admin2')).status).toBe(403);
  expect((await timeOut('admin', 'owner')).status).toBe(403);
  expect((await timeOut('admin', 'nobody')).status).toBe(404);
  expect((await timeOut('admin', 'member', { minutes: 7 })).status).toBe(400);
  expect(serverModule.db.getMemberTimeout(spaceId(), users.member.id)).toBeNull();
});

test('a timeout is stored, logged, told to them and to the member list', async () => {
  const before = Date.now();
  const res = await timeOut('admin', 'member', { minutes: 60, reason: ' cool off ' });
  expect(res.status).toBe(200);
  expect(res.body.until).toBeGreaterThanOrEqual(before + 60 * 60e3);
  await wait(120);
  expect(last('member', 'timed_out')).toEqual({ type: 'timed_out', space: SPACE, until: res.body.until, reason: 'cool off' });
  expect(last('owner', 'members_changed')).toBeTruthy();
  const members = (await call('owner', 'GET', `${S}/members`)).body.members;
  expect(members.find((m) => m.username === 'member').timedOutUntil).toBe(res.body.until);
  expect(members.find((m) => m.username === 'member2').timedOutUntil).toBeNull();
  const mine = (await call('member', 'GET', '/spaces')).body.find((s) => s.name === SPACE);
  expect(mine.timeout).toEqual({ until: res.body.until, reason: 'cool off' });
  expect(serverModule.db.getModLog(spaceId(), { action: 'timeout' }).entries[0]).toMatchObject({
    actor: 'admin', target: 'member', reason: 'cool off', details: { minutes: 60, until: res.body.until },
  });
});

test('while timed out: no posting, editing, reacting, threads or /imagine; reading still works', async () => {
  const { db } = serverModule;
  const gw = users.member.gw;
  const mine = db.storeMessage(SPACE, 'general', 'from before', users.member.id).id;
  const theirs = db.storeMessage(SPACE, 'general', 'hello', users.member2.id).id;
  gw.frames.length = 0;
  gw.send({ op: 'message', space: SPACE, channel: 'general', content: 'let me talk' });
  gw.send({ op: 'edit', id: mine, content: 'edited' });
  gw.send({ op: 'react', id: theirs, emoji: '👍' });
  gw.send({ op: 'imagine', space: SPACE, channel: 'general', prompt: 'a cat' });
  await wait(200);
  const errors = gw.frames.filter((f) => f.type === 'error');
  expect(errors.map((f) => f.op).sort()).toEqual(['edit', 'imagine', 'message', 'react']);
  expect(errors.every((f) => f.code === 'TIMED_OUT')).toBe(true);
  expect(errors.find((f) => f.op === 'message').until).toBeGreaterThan(Date.now());
  expect(gw.frames.some((f) => f.type === 'message' && f.content === 'let me talk')).toBe(false);
  expect(db.getReaction(theirs, '👍').count).toBe(0);
  const thread = await call('member', 'POST', `${S}/channels/general/threads`, { messageId: theirs, name: 'side' });
  expect(thread.status).toBe(403);
  expect(thread.body.code).toBe('TIMED_OUT');
  expect((await call('member', 'GET', `${S}/channels/general/messages?limit=5`)).status).toBe(200);
});

test('when it ends, everything works again (no job needed)', async () => {
  expire('member');
  const gw = users.member.gw;
  gw.frames.length = 0;
  gw.send({ op: 'message', space: SPACE, channel: 'general', content: 'back again' });
  await wait(150);
  expect(gw.frames.some((f) => f.type === 'message' && f.content === 'back again')).toBe(true);
  expect(gw.frames.some((f) => f.type === 'error')).toBe(false);
  expect((await call('member', 'GET', '/spaces')).body.find((s) => s.name === SPACE).timeout).toBeNull();
});

test('remove timeout: lifted early, logged, told; 404 when there is none', async () => {
  await timeOut('admin', 'member2');
  expect((await call('admin', 'DELETE', `${S}/members/member2/timeout`)).status).toBe(200);
  await wait(120);
  expect(last('member2', 'timed_out')).toEqual({ type: 'timed_out', space: SPACE, until: null, reason: null });
  expect(serverModule.db.getMemberTimeout(spaceId(), users.member2.id)).toBeNull();
  expect(serverModule.db.getModLog(spaceId(), { action: 'timeout_remove' }).entries[0]).toMatchObject({ actor: 'admin', target: 'member2' });
  expect((await call('admin', 'DELETE', `${S}/members/member2/timeout`)).status).toBe(404);
});

test('voice: timed out in a call → forced mute, and unmuting is ignored; joining while timed out starts muted', async () => {
  const m = users.member.gw;
  m.send({ op: 'voice_join', space: SPACE, channel: 'lounge' });
  await wait(150);
  expect(last('member', 'voice_peers').forcedMute).toBe(false);
  await timeOut('admin', 'member');
  await wait(150);
  expect(last('member', 'voice_forced_mute')).toEqual({ type: 'voice_forced_mute', space: SPACE, on: true });
  const me = (f) => f.participants.find((p) => p.username === 'member');
  expect(me(last('owner', 'voice_state')).muted).toBe(true);
  m.send({ op: 'voice_mute', muted: false });
  await wait(120);
  expect(me(last('owner', 'voice_state')).muted).toBe(true);
  // Rejoining while timed out starts muted.
  m.send({ op: 'voice_leave' });
  m.send({ op: 'voice_join', space: SPACE, channel: 'lounge' });
  await wait(150);
  expect(last('member', 'voice_peers').forcedMute).toBe(true);
  expect(me(last('owner', 'voice_state')).muted).toBe(true);
  // Removing the timeout lets them unmute again.
  await call('admin', 'DELETE', `${S}/members/member/timeout`);
  await wait(120);
  expect(last('member', 'voice_forced_mute')).toEqual({ type: 'voice_forced_mute', space: SPACE, on: false });
  m.send({ op: 'voice_mute', muted: false });
  await wait(120);
  expect(me(last('owner', 'voice_state')).muted).toBe(false);
});

test('voice: removing someone ends their call with a reason', async () => {
  // member is still in the lounge from the previous test.
  expect((await call('admin', 'DELETE', `${S}/members/member`)).status).toBe(200);
  await wait(150);
  expect(last('member', 'voice_ended')).toEqual({ type: 'voice_ended', space: SPACE, channel: 'lounge', reason: 'removed' });
  expect(last('owner', 'voice_state').participants.some((p) => p.username === 'member')).toBe(false);
});

test('voice: banning someone ends their call with a reason', async () => {
  users.member2.gw.send({ op: 'voice_join', space: SPACE, channel: 'lounge' });
  await wait(150);
  expect(last('owner', 'voice_state').participants.some((p) => p.username === 'member2')).toBe(true);
  expect((await call('admin', 'POST', `${S}/bans`, { user: 'member2' })).status).toBe(200);
  await wait(150);
  expect(last('member2', 'voice_ended')).toEqual({ type: 'voice_ended', space: SPACE, channel: 'lounge', reason: 'banned' });
  expect(last('owner', 'voice_state').participants.some((p) => p.username === 'member2')).toBe(false);
});

test('the owner can turn "Time out members" off for Admin', async () => {
  const { db } = serverModule;
  const adminRole = db.getRoles(spaceId()).find((r) => r.name === 'Admin');
  expect(adminRole.permissions).toContain('timeout_members');
  db.updateRole(spaceId(), adminRole.id, { permissions: adminRole.permissions.filter((p) => p !== 'timeout_members') });
  db.addMember(spaceId(), users.member.id, 'member');
  expect((await timeOut('admin', 'member')).status).toBe(403);
});
