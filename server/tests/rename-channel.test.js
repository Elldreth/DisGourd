// P6-03: rename a channel — validated like creation; messages, pins, threads,
// category and role overrides follow (they point at the id); read state moves
// with it; viewers hear about it; a voice room keeps its people; it's logged.
const WebSocket = require('ws');
const os = require('os');
const path = require('path');

let serverModule;
let port;
const SPACE = 'Renameland';

beforeAll((done) => {
  process.env.PORT = 0;
  process.env.JWT_SECRET = 'disgourd-test-secret-0123456789abcdef';
  process.env.DB_PATH = ':memory:';
  process.env.UPLOADS_DIR = path.join(os.tmpdir(), `disgourd-test-uploads-rename-${process.pid}`);
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
const rename = (who, channel, name) => call(who, 'PATCH', `${S}/channels/${encodeURIComponent(channel)}`, { name });
const raw = () => serverModule.db.raw;
const spaceId = () => serverModule.db.getSpaceByName(SPACE).id;
const channelRow = (name) => raw().prepare('SELECT * FROM channels WHERE space_id = ? AND name = ?').get(spaceId(), name);
const clearFrames = () => { for (const u of Object.values(users)) if (u.gw) u.gw.frames.length = 0; };

beforeAll(async () => {
  const { db } = serverModule;
  for (const name of ['owner', 'admin', 'member', 'outsider']) {
    const token = await register(name);
    users[name] = { token, id: db.getUserByUsername(name).id };
  }
  const id = db.createSpaceWithDefaults(SPACE, users.owner.id);
  db.addMember(id, users.admin.id, 'admin');
  db.addMember(id, users.member.id, 'member');
  db.createChannel(SPACE, 'lounge', 'voice');
  db.createChannel(SPACE, 'staff');
  db.createChannel(SPACE, 'other');
  for (const name of ['owner', 'admin', 'member']) {
    users[name].gw = gateway(users[name].token);
    await users[name].gw.ready;
  }
  await wait(100);
});

test('refusals: members, bad names, taken names, threads', async () => {
  expect((await rename('member', 'general', 'chat')).status).toBe(403);
  const empty = await rename('admin', 'general', '  !!  ');
  expect(empty.status).toBe(400);
  expect(empty.body.error).toMatch(/name is required/);
  expect((await rename('admin', 'general', 'x'.repeat(61))).status).toBe(400);
  expect((await rename('admin', 'general', 42)).status).toBe(400);
  const taken = await rename('admin', 'general', 'Other');
  expect(taken.status).toBe(409);
  expect(taken.body.error).toMatch(/already exists/);
  expect((await rename('admin', 'nope', 'chat')).status).toBe(404);
  expect(channelRow('general')).toBeTruthy();
});

test('a rename keeps messages, pins, threads, category, overrides and read state, and tells viewers', async () => {
  const { db } = serverModule;
  const before = channelRow('general');
  // A message (pinned), a thread on it, a role override, and read state.
  const gw = users.member.gw;
  gw.send({ op: 'message', space: SPACE, channel: 'general', content: 'hello there' });
  gw.send({ op: 'message', space: SPACE, channel: 'general', content: 'second' });
  await wait(150);
  const msgs = raw().prepare('SELECT id FROM messages WHERE channel_id = ? ORDER BY id').all(before.id);
  expect(msgs).toHaveLength(2);
  db.pinMessage(msgs[0].id, users.owner.id);
  db.createThread(SPACE, 'general', msgs[0].id, 'A thread', users.owner.id);
  const threadsOf = (id) => raw().prepare("SELECT COUNT(*) AS n FROM channels WHERE parent_id = ? AND type = 'thread'").get(id).n;
  expect(threadsOf(before.id)).toBe(1);
  const role = db.createRole(spaceId(), { name: 'Readers' });
  db.setChannelOverride(before.id, role.id, { view: 1 });
  db.markRead(users.admin.id, SPACE, 'general', msgs[0].id); // one unread left for admin
  const unreadFor = (who, ch) => db.getUnreadCounts(users[who].id).find((c) => c.space === SPACE && c.channel === ch)?.count || 0;
  expect(unreadFor('admin', 'general')).toBe(1);
  clearFrames();

  const res = await rename('admin', 'general', '  Game Night ');
  expect(res).toEqual({ status: 200, body: { name: 'game-night' } });
  await wait(150);

  // Same row, new name; the old name is gone.
  const after = channelRow('game-night');
  expect(after.id).toBe(before.id);
  expect(after.category_id).toBe(before.category_id);
  expect(channelRow('general')).toBeUndefined();
  const listed = (await call('member', 'GET', '/spaces')).body.find((s) => s.name === SPACE).channels;
  expect(listed).toContain('game-night');
  expect(listed).not.toContain('general');
  // Messages, pins, threads and overrides all still point at it.
  const history = (await call('member', 'GET', `${S}/channels/game-night/messages`)).body;
  const contents = (Array.isArray(history) ? history : history.messages).map((m) => m.content);
  expect(contents).toEqual(expect.arrayContaining(['hello there', 'second']));
  expect(db.getPins(SPACE, 'game-night').map((p) => p.id)).toContain(msgs[0].id);
  expect(threadsOf(before.id)).toBe(1);
  expect(raw().prepare('SELECT COUNT(*) AS n FROM channel_role_overrides WHERE channel_id = ?').get(before.id).n).toBe(1);
  // Read state moved: still one unread, now under the new name.
  expect(unreadFor('admin', 'game-night')).toBe(1);
  expect(unreadFor('admin', 'general')).toBe(0);

  // Viewers hear it, then the usual refresh; it's in the mod log.
  for (const name of ['owner', 'admin', 'member']) {
    const f = users[name].gw.frames;
    const i = f.findIndex((x) => x.type === 'channel_renamed');
    expect(f[i]).toEqual({ type: 'channel_renamed', space: SPACE, channel: 'general', newName: 'game-night' });
    expect(f.findIndex((x) => x.type === 'space_updated')).toBeGreaterThan(i);
  }
  expect(db.getModLog(spaceId(), { action: 'channel_rename' }).entries[0]).toMatchObject({ actor: 'admin', details: { from: 'general', to: 'game-night' } });
});

test("members who can't see the channel aren't told", async () => {
  const { db } = serverModule;
  // Hide #staff from @everyone (members); the owner and admin still see it.
  const everyone = db.getRoles(spaceId()).find((r) => r.isDefault);
  db.setChannelOverride(channelRow('staff').id, everyone.id, { view: 0 });
  clearFrames();
  expect((await rename('owner', 'staff', 'mods-only')).status).toBe(200);
  await wait(150);
  expect(users.owner.gw.frames.some((f) => f.type === 'channel_renamed' && f.newName === 'mods-only')).toBe(true);
  expect(users.member.gw.frames.some((f) => f.type === 'channel_renamed')).toBe(false);
});

test('renaming to the same name changes nothing and logs nothing; topic and name together', async () => {
  const { db } = serverModule;
  const logged = () => db.getModLog(spaceId(), { action: 'channel_rename' }).entries.length;
  const n = logged();
  expect((await rename('admin', 'other', 'other')).status).toBe(200);
  expect(logged()).toBe(n);
  const both = await call('admin', 'PATCH', `${S}/channels/other`, { topic: 'Off topic', name: 'off-topic' });
  expect(both.body).toEqual({ name: 'off-topic', topic: 'Off topic' });
  const meta = (await call('admin', 'GET', '/spaces')).body.find((s) => s.name === SPACE).channelMeta['off-topic'];
  expect(meta.topic).toBe('Off topic');
});

test('people in a renamed voice channel stay connected, under the new name', async () => {
  const { gw } = users.member;
  gw.send({ op: 'voice_join', space: SPACE, channel: 'lounge' });
  await wait(150);
  clearFrames();
  expect((await rename('owner', 'lounge', 'hangout')).status).toBe(200);
  await wait(150);
  const states = gw.frames.filter((f) => f.type === 'voice_state' && f.space === SPACE);
  expect(states.at(-1)).toMatchObject({ channel: 'hangout', participants: [expect.objectContaining({ username: 'member' })] });
  expect(gw.frames.some((f) => f.type === 'voice_ended')).toBe(false);
  const renamedAt = gw.frames.findIndex((f) => f.type === 'channel_renamed');
  expect(renamedAt).toBeGreaterThanOrEqual(0);
  expect(renamedAt).toBeLessThan(gw.frames.indexOf(states.at(-1)));
  // A new connection sees the room under its new name; mute still reaches it.
  const late = gateway(users.admin.token);
  await late.ready;
  await wait(150);
  expect(late.frames.find((f) => f.type === 'voice_state' && f.channel === 'hangout')?.participants).toHaveLength(1);
  late.close();
  clearFrames();
  gw.send({ op: 'voice_mute', muted: true });
  await wait(150);
  expect(users.owner.gw.frames.find((f) => f.type === 'voice_state' && f.channel === 'hangout')?.participants[0].muted).toBe(true);
});
