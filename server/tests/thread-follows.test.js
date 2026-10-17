// P2-22c: following threads. You follow a thread you start, post in or are
// @mentioned in (or by hand). Followed threads count as unread; mentions in
// any thread you can see count as mentions.
const WebSocket = require('ws');
const os = require('os');
const path = require('path');

let serverModule;
let port;
const users = {}; // name -> { token, id, gw, frames }

beforeAll((done) => {
  process.env.PORT = 0;
  process.env.JWT_SECRET = 'disgourd-test-secret-0123456789abcdef';
  process.env.DB_PATH = ':memory:';
  process.env.UPLOADS_DIR = path.join(os.tmpdir(), `disgourd-test-uploads-follows-${process.pid}`);
  serverModule = require('../server');
  serverModule.httpServer.listen(0, () => {
    port = serverModule.httpServer.address().port;
    done();
  });
});

afterAll((done) => {
  for (const u of Object.values(users)) u.gw?.close();
  serverModule.httpServer.close(done);
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const base = () => `http://localhost:${port}`;
const auth = (who) => ({ Authorization: `Bearer ${users[who].token}` });
const req = (who, method, p, body) =>
  fetch(`${base()}${p}`, { method, headers: { 'content-type': 'application/json', ...auth(who) }, body: body && JSON.stringify(body) });
const send = (who, frame) => users[who].gw.send(JSON.stringify(frame));
const framesOf = (who, type) => users[who].frames.filter((f) => f.type === type);
const SPACE = 'Followers';
const enc = (c) => encodeURIComponent(c);

async function register(username) {
  const res = await fetch(`${base()}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'password123', email: `${username}@example.com` }),
  });
  return (await res.json()).token;
}

function connect(who) {
  const u = users[who];
  u.frames = [];
  u.gw = new WebSocket(`ws://localhost:${port}/gateway?token=${u.token}`);
  u.gw.on('message', (raw) => u.frames.push(JSON.parse(raw.toString())));
  return new Promise((r) => u.gw.on('open', r));
}

// A fresh connection's unread frame (what a client starts from).
async function reconnect(who) {
  users[who].gw.close();
  await connect(who);
  await wait(80);
  return framesOf(who, 'unread')[0];
}

beforeAll(async () => {
  const { db } = serverModule;
  for (const name of ['owner', 'ann', 'ben', 'cat']) {
    const token = await register(name);
    users[name] = { token, id: db.getUserByUsername(name).id, frames: [] };
  }
  const spaceId = db.createSpaceWithDefaults(SPACE, users.owner.id);
  for (const n of ['ann', 'ben', 'cat']) db.addMember(spaceId, users[n].id, 'member');
  for (const n of Object.keys(users)) await connect(n);
  await wait(80);
});

let thread;

test('starting a thread follows it; the creator is told', async () => {
  const rootId = serverModule.db.storeMessage(SPACE, 'general', 'Weekend plans?', users.owner.id).id;
  const res = await req('ann', 'POST', `/spaces/${SPACE}/channels/general/threads`, { messageId: rootId, name: 'Weekend' });
  thread = (await res.json()).thread;
  await wait(60);
  expect(framesOf('ann', 'thread_follow').at(-1)).toEqual({ type: 'thread_follow', space: SPACE, channel: thread.channel, parentChannel: 'general', name: 'Weekend', followed: true });
  expect(framesOf('ben', 'thread_follow')).toEqual([]);
  const list = await (await fetch(`${base()}/spaces/${SPACE}/channels/general/threads`, { headers: auth('ann') })).json();
  expect(list[0]).toMatchObject({ channel: thread.channel, followed: true });
  const benList = await (await fetch(`${base()}/spaces/${SPACE}/channels/general/threads`, { headers: auth('ben') })).json();
  expect(benList[0]).toMatchObject({ channel: thread.channel, followed: false });
});

test('posting in a thread follows it, and so does being @mentioned there; the frame says which thread', async () => {
  send('ben', { op: 'message', space: SPACE, channel: thread.channel, content: 'Hiking? @cat come too' });
  await wait(100);
  expect(framesOf('ben', 'thread_follow').at(-1)).toMatchObject({ channel: thread.channel, followed: true });
  expect(framesOf('cat', 'thread_follow').at(-1)).toMatchObject({ channel: thread.channel, parentChannel: 'general', followed: true });
  expect(framesOf('owner', 'thread_follow')).toEqual([]); // reading along is not following
  const msg = framesOf('cat', 'message').find((f) => f.content.startsWith('Hiking'));
  expect(msg.thread).toEqual({ name: 'Weekend', parentChannel: 'general' });
  // Posting again doesn't repeat the frame.
  send('ben', { op: 'message', space: SPACE, channel: thread.channel, content: 'second' });
  await wait(80);
  expect(framesOf('ben', 'thread_follow')).toHaveLength(1);
});

test('the connect-time unread frame counts followed threads (with their parent) and not others', async () => {
  // cat follows (mentioned) and has read nothing; owner doesn't follow.
  const catFrame = await reconnect('cat');
  expect(catFrame.counts).toContainEqual(expect.objectContaining({ space: SPACE, channel: thread.channel, parent: 'general', count: 2 }));
  expect(catFrame.mentions).toContainEqual(expect.objectContaining({ space: SPACE, channel: thread.channel, parent: 'general', count: 1 }));
  expect(catFrame.threads).toEqual([{ space: SPACE, channel: thread.channel, parent: 'general', name: 'Weekend' }]);
  const ownerFrame = await reconnect('owner');
  expect(ownerFrame.counts.map((c) => c.channel)).not.toContain(thread.channel);
  expect(ownerFrame.threads).toEqual([]);
});

test('unfollowing stops the unread count; a mention in an unfollowed thread still counts', async () => {
  expect((await req('cat', 'DELETE', `/spaces/${SPACE}/channels/${enc(thread.channel)}/follow`)).status).toBe(200);
  await wait(60);
  expect(framesOf('cat', 'thread_follow').at(-1)).toMatchObject({ channel: thread.channel, followed: false });
  const frame = await reconnect('cat');
  expect(frame.counts.map((c) => c.channel)).not.toContain(thread.channel);
  expect(frame.mentions).toContainEqual(expect.objectContaining({ channel: thread.channel, count: 1 }));
  expect(frame.threads).toEqual([]);
  // Following by hand again.
  const put = await req('cat', 'PUT', `/spaces/${SPACE}/channels/${enc(thread.channel)}/follow`);
  expect(await put.json()).toEqual({ followed: true });
  expect((await reconnect('cat')).counts.map((c) => c.channel)).toContain(thread.channel);
});

test('only threads you can see can be followed, and only threads', async () => {
  expect((await req('cat', 'PUT', `/spaces/${SPACE}/channels/general/follow`)).status).toBe(404);
  const { db } = serverModule;
  db.createChannel(SPACE, 'staff');
  db.setChannelPerms(SPACE, 'staff', 2, 2);
  const root = db.storeMessage(SPACE, 'staff', 'private', users.owner.id).id;
  const { thread: st } = await (await req('owner', 'POST', `/spaces/${SPACE}/channels/staff/threads`, { messageId: root })).json();
  expect((await req('cat', 'PUT', `/spaces/${SPACE}/channels/${enc(st.channel)}/follow`)).status).toBe(403);
});

test('reading the thread clears its count; deleting the thread drops the follow', async () => {
  const { db } = serverModule;
  send('cat', { op: 'read', space: SPACE, channel: thread.channel, lastId: 999999 });
  await wait(60);
  expect((await reconnect('cat')).counts.map((c) => c.channel)).not.toContain(thread.channel);
  expect(db.getThreadFollows(users.cat.id).map((t) => t.channel)).toContain(thread.channel);
  db.deleteChannel(SPACE, 'general'); // cascades to the thread and its follows
  expect(db.getThreadFollows(users.cat.id)).toEqual([]);
});
