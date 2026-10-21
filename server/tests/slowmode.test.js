// P3-26d: slow mode — the setting (managers only, text channels, logged),
// refusals with retryAfter, moderators exempt, threads inherit.
const WebSocket = require('ws');
const os = require('os');
const path = require('path');

let serverModule;
let port;
const SPACE = 'Slowland';

beforeAll((done) => {
  process.env.PORT = 0;
  process.env.JWT_SECRET = 'disgourd-test-secret-0123456789abcdef';
  process.env.DB_PATH = ':memory:';
  process.env.UPLOADS_DIR = path.join(os.tmpdir(), `disgourd-test-uploads-slowmode-${process.pid}`);
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
const spaceId = () => serverModule.db.getSpaceByName(SPACE).id;
const setSlow = (who, channel, slowmode) => call(who, 'PATCH', `${S}/channels/${channel}`, { slowmode });

// Post as `name`; resolves with whether it went through, and any refusal.
async function post(name, content, channel = 'general') {
  const gw = users[name].gw;
  gw.frames.length = 0;
  gw.send({ op: 'message', space: SPACE, channel, content });
  await wait(120);
  return {
    stored: gw.frames.some((f) => f.type === 'message' && f.content === content),
    refusal: gw.frames.find((f) => f.type === 'error' && f.op === 'message') || null,
  };
}

beforeAll(async () => {
  const { db } = serverModule;
  for (const name of ['owner', 'admin', 'member']) {
    const token = await register(name);
    users[name] = { token, id: db.getUserByUsername(name).id };
  }
  const id = db.createSpaceWithDefaults(SPACE, users.owner.id);
  db.addMember(id, users.admin.id, 'admin');
  db.addMember(id, users.member.id, 'member');
  db.createChannel(SPACE, 'lounge', 'voice');
  db.createChannel(SPACE, 'quiet');
  for (const name of ['owner', 'admin', 'member']) {
    users[name].gw = gateway(users[name].token);
    await users[name].gw.ready;
  }
  await wait(100);
});

test('only managers set it, only on text channels, only to the listed values', async () => {
  expect((await setSlow('member', 'general', 30)).status).toBe(403);
  expect((await setSlow('admin', 'general', 7)).status).toBe(400);
  expect((await setSlow('admin', 'lounge', 30)).status).toBe(400);
  const res = await setSlow('admin', 'general', 30);
  expect(res).toEqual({ status: 200, body: { slowmode: 30 } });
  await wait(100);
  expect(users.member.gw.frames.some((f) => f.type === 'space_updated' && f.space === SPACE)).toBe(true);
  const mine = (await call('member', 'GET', '/spaces')).body.find((s) => s.name === SPACE);
  expect(mine.channelMeta.general.slowmode).toBe(30);
  expect(mine.channelMeta.quiet.slowmode).toBe(0);
  expect(serverModule.db.getModLog(spaceId(), { action: 'slowmode' }).entries[0]).toMatchObject({ actor: 'admin', details: { channel: 'general', seconds: 30 } });
  // Saving the same value again isn't logged twice.
  await setSlow('admin', 'general', 30);
  expect(serverModule.db.getModLog(spaceId(), { action: 'slowmode' }).entries).toHaveLength(1);
});

test('a second post too soon is refused with retryAfter; other channels are unaffected', async () => {
  expect((await post('member', 'first')).stored).toBe(true);
  const second = await post('member', 'second');
  expect(second.stored).toBe(false);
  expect(second.refusal).toMatchObject({ code: 'SLOWMODE', space: SPACE, channel: 'general' });
  expect(second.refusal.retryAfter).toBeGreaterThan(25);
  expect(second.refusal.retryAfter).toBeLessThanOrEqual(30);
  expect((await post('member', 'elsewhere', 'quiet')).stored).toBe(true);
});

test('after the wait, posting works again', async () => {
  // Move the last post back past the window, as if 31 seconds had gone by.
  serverModule.db.raw.prepare('UPDATE messages SET created_at = created_at - 31000 WHERE author_id = ?').run(users.member.id);
  expect((await post('member', 'later')).stored).toBe(true);
});

test('moderators and the owner are exempt', async () => {
  expect((await post('admin', 'a1')).stored).toBe(true);
  expect((await post('admin', 'a2')).stored).toBe(true);
  expect((await post('owner', 'o1')).stored).toBe(true);
  expect((await post('owner', 'o2')).stored).toBe(true);
});

test("threads follow their parent channel's slow mode", async () => {
  const { db } = serverModule;
  const root = db.storeMessage(SPACE, 'general', 'thread root', users.owner.id).id;
  const made = await call('owner', 'POST', `${S}/channels/general/threads`, { messageId: root, name: 'side chat' });
  const thread = made.body.thread.channel;
  expect((await post('member', 't1', thread)).stored).toBe(true);
  const again = await post('member', 't2', thread);
  expect(again.refusal).toMatchObject({ code: 'SLOWMODE', channel: thread });
  // Turned off on the parent: the thread is free too.
  await setSlow('admin', 'general', 0);
  expect((await post('member', 't3', thread)).stored).toBe(true);
  expect((await post('member', 'free', 'general')).stored).toBe(true);
  expect((await post('member', 'free again', 'general')).stored).toBe(true);
});
