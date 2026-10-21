// P2-22d: threads quiet for THREAD_ARCHIVE_DAYS (default 7) are archived by an
// hourly sweep. Posting reopens one; moderators can archive or reopen by hand.
const WebSocket = require('ws');
const os = require('os');
const path = require('path');

let serverModule;
let port;
const users = {}; // name -> { token, id, gw, frames }
const DAY = 24 * 60 * 60 * 1000;

beforeAll((done) => {
  process.env.PORT = 0;
  process.env.JWT_SECRET = 'disgourd-test-secret-0123456789abcdef';
  process.env.DB_PATH = ':memory:';
  process.env.UPLOADS_DIR = path.join(os.tmpdir(), `disgourd-test-uploads-archive-${process.pid}`);
  process.env.THREAD_ARCHIVE_DAYS = '3'; // shorter than the default, to show it's honoured
  serverModule = require('../server');
  serverModule.httpServer.listen(0, () => {
    port = serverModule.httpServer.address().port;
    done();
  });
});

afterAll((done) => {
  delete process.env.THREAD_ARCHIVE_DAYS;
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
const SPACE = 'Archive';
const enc = (c) => encodeURIComponent(c);
const listThreads = async (who, archived) =>
  (await fetch(`${base()}/spaces/${SPACE}/channels/general/threads${archived ? '?archived=1' : ''}`, { headers: auth(who) })).json();

async function register(username) {
  const res = await fetch(`${base()}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'gourd-test-pass-1', email: `${username}@example.com` }),
  });
  return (await res.json()).token;
}

async function startThread(who, content, name) {
  const rootId = serverModule.db.storeMessage(SPACE, 'general', content, users[who].id).id;
  const res = await req(who, 'POST', `/spaces/${SPACE}/channels/general/threads`, { messageId: rootId, name });
  return (await res.json()).thread;
}
const setQuietFor = (thread, days) =>
  serverModule.db.raw.prepare('UPDATE channels SET last_activity_at = ? WHERE id = ?').run(Date.now() - days * DAY, thread.id);

beforeAll(async () => {
  const { db } = serverModule;
  for (const name of ['owner', 'mod', 'member']) {
    const token = await register(name);
    users[name] = { token, id: db.getUserByUsername(name).id, frames: [] };
  }
  const spaceId = db.createSpaceWithDefaults(SPACE, users.owner.id);
  db.addMember(spaceId, users.mod.id, 'admin');
  db.addMember(spaceId, users.member.id, 'member');
  for (const u of Object.values(users)) {
    u.gw = new WebSocket(`ws://localhost:${port}/gateway?token=${u.token}`);
    u.gw.on('message', (raw) => u.frames.push(JSON.parse(raw.toString())));
    await new Promise((r) => u.gw.on('open', r));
  }
  await wait(80);
});

let quiet;
let recent;

test('the sweep archives a thread quiet for longer than THREAD_ARCHIVE_DAYS and leaves a recent one alone', async () => {
  quiet = await startThread('member', 'old news', 'Quiet');
  recent = await startThread('member', 'hot topic', 'Recent');
  setQuietFor(quiet, 4); // over the 3-day limit
  setQuietFor(recent, 2); // under it (the default 7 would have spared both)
  const { sweepQuietThreads } = require('../gateway');
  expect(sweepQuietThreads().map((t) => t.name)).toEqual(['Quiet']);
  expect(sweepQuietThreads()).toEqual([]); // already archived: nothing more to do
  await wait(60);
  const frame = framesOf('owner', 'thread_updated').find((f) => f.thread.channel === quiet.channel);
  expect(frame).toMatchObject({ space: SPACE, channel: 'general', rootMessageId: quiet.rootMessageId, thread: { archived: true } });
  expect((await listThreads('member')).map((t) => t.name)).toEqual(['Recent']);
  expect((await listThreads('member', true)).map((t) => t.name)).toEqual(['Quiet']);
  // The root message's summary says so too.
  const history = await (await fetch(`${base()}/spaces/${SPACE}/channels/general/messages`, { headers: auth('member') })).json();
  expect(history.find((m) => m.id === quiet.rootMessageId).thread).toMatchObject({ archived: true });
  expect(history.find((m) => m.id === recent.rootMessageId).thread).toMatchObject({ archived: false });
});

test('posting in an archived thread reopens it', async () => {
  send('member', { op: 'message', space: SPACE, channel: quiet.channel, content: 'still relevant' });
  await wait(100);
  expect(framesOf('owner', 'thread_updated').at(-1)).toMatchObject({ thread: { channel: quiet.channel, archived: false, messageCount: 1 } });
  expect((await listThreads('member')).map((t) => t.name)).toEqual(['Quiet', 'Recent']);
});

test('moderators can archive and reopen by hand; members cannot', async () => {
  const url = `/spaces/${SPACE}/channels/${enc(quiet.channel)}/archive`;
  expect((await req('member', 'PUT', url)).status).toBe(403);
  const put = await req('mod', 'PUT', url);
  expect(put.status).toBe(200);
  expect((await put.json()).thread).toMatchObject({ channel: quiet.channel, archived: true });
  await wait(60);
  expect(framesOf('member', 'thread_updated').at(-1)).toMatchObject({ thread: { channel: quiet.channel, archived: true } });
  expect((await req('member', 'DELETE', url)).status).toBe(403);
  const del = await req('mod', 'DELETE', url);
  expect((await del.json()).thread).toMatchObject({ archived: false });
  expect((await listThreads('member')).map((t) => t.name)).toContain('Quiet');
  // Not a thread: nothing to archive.
  expect((await req('mod', 'PUT', `/spaces/${SPACE}/channels/general/archive`)).status).toBe(404);
});

test('an archived thread stays readable', async () => {
  await req('mod', 'PUT', `/spaces/${SPACE}/channels/${enc(quiet.channel)}/archive`);
  const res = await fetch(`${base()}/spaces/${SPACE}/channels/${enc(quiet.channel)}/messages`, { headers: auth('member') });
  expect(res.status).toBe(200);
  expect((await res.json()).map((m) => m.content)).toEqual(['still relevant']);
});
