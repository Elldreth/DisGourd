// P2-22a: threads are hidden child channels (~t<id>) of a text channel. They
// reuse all channel machinery and inherit the parent's access.
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
  process.env.UPLOADS_DIR = path.join(os.tmpdir(), `disgourd-test-uploads-threads-${process.pid}`);
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
const get = (who, p) => fetch(`${base()}${p}`, { headers: auth(who) });
const req = (who, method, p, body) =>
  fetch(`${base()}${p}`, { method, headers: { 'content-type': 'application/json', ...auth(who) }, body: body && JSON.stringify(body) });
const send = (who, frame) => users[who].gw.send(JSON.stringify(frame));
const framesOf = (who, type) => users[who].frames.filter((f) => f.type === type);
const post = (who, content, channel = 'general') => serverModule.db.storeMessage('Threadville', channel, content, users[who].id).id;
const startThread = (who, channel, messageId, name) => req(who, 'POST', `/spaces/Threadville/channels/${channel}/threads`, { messageId, name });

async function register(username) {
  const res = await fetch(`${base()}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'password123', email: `${username}@example.com` }),
  });
  return (await res.json()).token;
}

beforeAll(async () => {
  const { db } = serverModule;
  for (const name of ['owner', 'admin', 'member', 'stranger']) {
    const token = await register(name);
    users[name] = { token, id: db.getUserByUsername(name).id, frames: [] };
  }
  const spaceId = db.createSpaceWithDefaults('Threadville', users.owner.id);
  db.addMember(spaceId, users.admin.id, 'admin');
  db.addMember(spaceId, users.member.id, 'member');
  db.createChannel('Threadville', 'staff');
  db.setChannelPerms('Threadville', 'staff', 2, 2);
  db.createChannel('Threadville', 'news');
  db.setChannelPerms('Threadville', 'news', 1, 2); // members read, admins post
  db.createChannel('Threadville', 'lounge', 'voice');
  for (const u of Object.values(users)) {
    u.gw = new WebSocket(`ws://localhost:${port}/gateway?token=${u.token}`);
    u.gw.on('message', (raw) => u.frames.push(JSON.parse(raw.toString())));
    await new Promise((r) => u.gw.on('open', r));
  }
  await wait(80);
});

let thread; // the first thread, reused below
let rootId;

test('a member starts a thread from a message; viewers are told', async () => {
  rootId = post('owner', 'Plans for the weekend? Let us discuss the details here');
  const res = await startThread('member', 'general', rootId, '  Weekend plans  ');
  expect(res.status).toBe(201);
  thread = (await res.json()).thread;
  expect(thread).toMatchObject({
    channel: `~t${rootId}`,
    name: 'Weekend plans',
    rootMessageId: Number(rootId),
    parentChannel: 'general',
    messageCount: 0,
    archived: false,
    createdBy: 'member',
  });
  await wait(60);
  for (const who of ['owner', 'admin', 'member']) {
    expect(framesOf(who, 'thread_created').at(-1)).toMatchObject({ space: 'Threadville', channel: 'general', thread: { channel: thread.channel } });
  }
  expect(framesOf('stranger', 'thread_created')).toEqual([]);
});

test('one thread per message; the name defaults to the start of the message', async () => {
  const again = await startThread('admin', 'general', rootId, 'Another name');
  expect(again.status).toBe(200);
  expect((await again.json()).thread).toMatchObject({ channel: thread.channel, name: 'Weekend plans' });

  const id = post('admin', 'A rather long message that will be cut down to make a thread name');
  const t = (await (await startThread('member', 'general', id)).json()).thread;
  expect(t.name).toBe('A rather long message that will be cut…');
  expect(t.name.length).toBeLessThanOrEqual(40);
});

test('posting in the thread: only parent viewers get it, and the root summary counts it live', async () => {
  send('admin', { op: 'message', space: 'Threadville', channel: thread.channel, content: 'Hiking on Saturday?' });
  await wait(100);
  const got = (who) => framesOf(who, 'message').some((f) => f.channel === thread.channel && f.content === 'Hiking on Saturday?');
  expect(got('member')).toBe(true);
  expect(got('stranger')).toBe(false);
  expect(framesOf('member', 'thread_updated').at(-1)).toMatchObject({
    space: 'Threadville', channel: 'general', rootMessageId: Number(rootId), thread: { messageCount: 1 },
  });
  // The parent's history carries the summary; the thread's messages are not in it.
  const parent = await (await get('member', '/spaces/Threadville/channels/general/messages')).json();
  expect(parent.find((m) => Number(m.id) === Number(rootId)).thread).toMatchObject({ channel: thread.channel, name: 'Weekend plans', messageCount: 1 });
  expect(parent.some((m) => m.content === 'Hiking on Saturday?')).toBe(false);
  expect(parent.find((m) => m.content.startsWith('A rather long')).thread).toMatchObject({ messageCount: 0 });
  expect(parent.filter((m) => !m.thread).every((m) => m.thread === null)).toBe(true);
});

test('thread history, around and pins all work at /channels/~tN', async () => {
  const enc = encodeURIComponent(thread.channel);
  const history = await (await get('member', `/spaces/Threadville/channels/${enc}/messages`)).json();
  expect(history.map((m) => m.content)).toEqual(['Hiking on Saturday?']);
  const around = await get('member', `/spaces/Threadville/channels/${enc}/messages?around=${history[0].id}`);
  expect(around.status).toBe(200);
  send('admin', { op: 'pin', id: history[0].id });
  await wait(80);
  const pins = await (await get('member', `/spaces/Threadville/channels/${enc}/pins`)).json();
  expect(pins.map((m) => m.content)).toEqual(['Hiking on Saturday?']);
});

test('threads are listed per channel, newest activity first, and hidden from channel lists', async () => {
  const list = await (await get('member', '/spaces/Threadville/channels/general/threads')).json();
  expect(list.map((t) => t.name)).toEqual(['Weekend plans', 'A rather long message that will be cut…']);
  const spaces = await (await get('member', '/spaces')).json();
  const tv = spaces.find((s) => s.name === 'Threadville');
  expect(tv.channels.some((c) => c.startsWith('~t'))).toBe(false);
  expect(tv.voiceChannels.some((c) => c.startsWith('~t'))).toBe(false);
  expect(Object.keys(tv.channelMeta).some((c) => c.startsWith('~t'))).toBe(false);
});

test('you need to be able to post in the parent, and only text channels have threads', async () => {
  const newsMsg = post('admin', 'Big announcement', 'news');
  expect((await startThread('member', 'news', newsMsg)).status).toBe(403); // can read, can't post
  expect((await startThread('admin', 'news', newsMsg)).status).toBe(201);
  expect((await startThread('member', 'general', newsMsg)).status).toBe(404); // not in that channel
  expect((await startThread('member', 'lounge', newsMsg)).status).toBe(400); // voice channel
  expect((await startThread('member', encodeURIComponent(thread.channel), newsMsg)).status).toBe(400); // no threads in threads
  expect((await startThread('member', 'general', rootId, 'x'.repeat(81))).status).toBe(200); // existing thread wins over a bad name
  const fresh = post('member', 'name check');
  expect((await startThread('member', 'general', fresh, 'x'.repeat(81))).status).toBe(400);
});

test("a private channel's threads stay private everywhere (messages, lists, search, counts)", async () => {
  const staffMsg = post('admin', 'staff matter');
  const { thread: st } = await (await startThread('admin', 'staff', serverModule.db.storeMessage('Threadville', 'staff', 'secret root', users.admin.id).id)).json();
  void staffMsg;
  const enc = encodeURIComponent(st.channel);
  expect((await get('member', `/spaces/Threadville/channels/${enc}/messages`)).status).toBe(403);
  expect((await get('member', '/spaces/Threadville/channels/staff/threads')).status).toBe(403);
  send('admin', { op: 'message', space: 'Threadville', channel: st.channel, content: 'zebra secret @member' });
  await wait(100);
  expect(framesOf('member', 'message').some((f) => f.content === 'zebra secret @member')).toBe(false);
  const search = await (await get('member', '/search?q=zebra')).json();
  expect(search.channels).toEqual([]);
  const adminSearch = await (await get('admin', '/search?q=zebra')).json();
  expect(adminSearch.channels[0]).toMatchObject({ channel: st.channel, thread: { name: 'secret root', parentChannel: 'staff' } });
  const counts = serverModule.db.getUnreadCounts(users.member.id).map((c) => c.channel);
  expect(counts).not.toContain(st.channel);
  expect(serverModule.db.getMentionCounts(users.member.id).map((c) => c.channel)).not.toContain(st.channel);
});

test("changing the parent's access applies to its threads at once", async () => {
  const msg = serverModule.db.storeMessage('Threadville', 'news', 'policy root', users.admin.id).id;
  const { thread: nt } = await (await startThread('admin', 'news', msg)).json();
  const enc = encodeURIComponent(nt.channel);
  expect((await get('member', `/spaces/Threadville/channels/${enc}/messages`)).status).toBe(200);
  await req('owner', 'PATCH', '/spaces/Threadville/channels/news/permissions', { view: 2, post: 2 });
  expect((await get('member', `/spaces/Threadville/channels/${enc}/messages`)).status).toBe(403);
  await req('owner', 'PATCH', '/spaces/Threadville/channels/news/permissions', { view: 1, post: 2 });
  expect((await get('member', `/spaces/Threadville/channels/${enc}/messages`)).status).toBe(200);
});

test('thread channels are not managed like normal channels', async () => {
  const enc = encodeURIComponent(thread.channel);
  expect((await req('owner', 'DELETE', `/spaces/Threadville/channels/${enc}`)).status).toBe(404);
  expect((await req('owner', 'PATCH', `/spaces/Threadville/channels/${enc}/permissions`, { view: 3, post: 3 })).status).toBe(404);
  const created = await (await req('owner', 'POST', '/spaces/Threadville/channels', { name: '~t9999' })).json();
  expect(created.name).toBe('t9999'); // the ~ can never be used in a real channel name
});

test('deleting the root keeps the thread; deleting the parent channel removes its threads', async () => {
  const { db } = serverModule;
  db.createChannel('Threadville', 'temp');
  const root = db.storeMessage('Threadville', 'temp', 'temporary root', users.owner.id).id;
  const { thread: tt } = await (await startThread('owner', 'temp', root)).json();
  send('owner', { op: 'delete', id: root });
  await wait(80);
  expect((await (await get('owner', '/spaces/Threadville/channels/temp/threads')).json()).map((t) => t.channel)).toContain(tt.channel);
  await req('owner', 'DELETE', '/spaces/Threadville/channels/temp');
  expect(db.channelType('Threadville', tt.channel)).toBeNull();
});
