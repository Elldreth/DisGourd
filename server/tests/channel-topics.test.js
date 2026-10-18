// P3-20a: channel topics — set, change and clear by managers, carried in
// GET /spaces, broadcast live, and never on threads.
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

let serverModule;
let db;
let port;
const users = {};
const SPACE = 'Topics';

beforeAll((done) => {
  process.env.PORT = 0;
  process.env.JWT_SECRET = 'disgourd-test-secret-0123456789abcdef';
  process.env.DB_PATH = ':memory:';
  process.env.UPLOADS_DIR = path.join(os.tmpdir(), `disgourd-test-uploads-topics-${process.pid}`);
  serverModule = require('../server');
  db = serverModule.db;
  serverModule.httpServer.listen(0, () => {
    port = serverModule.httpServer.address().port;
    done();
  });
});
afterAll((done) => {
  for (const u of Object.values(users)) u.gw?.close();
  serverModule.httpServer.close(done);
});

const call = async (who, method, p, body) => {
  const res = await fetch(`http://localhost:${port}${p}`, {
    method, headers: { 'content-type': 'application/json', Authorization: `Bearer ${users[who].token}` }, body: body && JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const S = `/spaces/${SPACE}`;
const meta = async (who, channel) => (await call(who, 'GET', '/spaces')).body.find((s) => s.name === SPACE).channelMeta[channel];

beforeAll(async () => {
  for (const name of ['owner', 'member']) {
    const res = await fetch(`http://localhost:${port}/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: name, password: 'password123', email: `${name}@example.com` }),
    });
    users[name] = { token: (await res.json()).token, id: db.getUserByUsername(name).id, frames: [] };
  }
  const spaceId = db.createSpaceWithDefaults(SPACE, users.owner.id);
  db.addMember(spaceId, users.member.id, 'member');
  const m = users.member;
  m.gw = new WebSocket(`ws://localhost:${port}/gateway?token=${m.token}`);
  m.gw.on('message', (raw) => m.frames.push(JSON.parse(raw.toString())));
  await new Promise((r) => m.gw.on('open', r));
});

test('a manager sets, changes and clears a topic; GET /spaces carries it; members are told', async () => {
  expect(await meta('member', 'general')).toMatchObject({ topic: null });
  const set = await call('owner', 'PATCH', `${S}/channels/general`, { topic: '  Say hi and introduce yourself.\nBe kind.  ' });
  expect(set).toEqual({ status: 200, body: { topic: 'Say hi and introduce yourself.\nBe kind.' } });
  expect((await meta('member', 'general')).topic).toBe('Say hi and introduce yourself.\nBe kind.');
  await new Promise((r) => setTimeout(r, 50));
  expect(users.member.frames.some((f) => f.type === 'space_updated' && f.space === SPACE)).toBe(true);
  expect((await call('owner', 'PATCH', `${S}/channels/general`, { topic: 'x'.repeat(300) })).status).toBe(200);
  expect((await call('owner', 'PATCH', `${S}/channels/general`, { topic: 'x'.repeat(301) })).body).toEqual({ error: 'Topics are at most 300 characters' });
  expect((await call('owner', 'PATCH', `${S}/channels/general`, { topic: '   ' })).body).toEqual({ topic: null });
  expect((await meta('member', 'general')).topic).toBeNull();
});

test('who and what: members are refused, bad bodies explained, threads have no topic', async () => {
  expect((await call('member', 'PATCH', `${S}/channels/general`, { topic: 'mine now' })).status).toBe(403);
  expect((await call('owner', 'PATCH', `${S}/channels/general`, {})).body).toEqual({ error: 'Nothing to change' });
  expect((await call('owner', 'PATCH', `${S}/channels/general`, { topic: 42 })).body).toEqual({ error: 'The topic must be text' });
  expect((await call('owner', 'PATCH', `${S}/channels/nowhere`, { topic: 'x' })).status).toBe(404);
  const root = db.storeMessage(SPACE, 'general', 'root', users.owner.id);
  const thread = (await call('owner', 'POST', `${S}/channels/general/threads`, { messageId: Number(root.id), name: 't' })).body.thread;
  expect((await call('owner', 'PATCH', `${S}/channels/${encodeURIComponent(thread.channel || `~t${root.id}`)}`, { topic: 'no' })).status).toBe(404);
});

test('nsfw and topic together, or either alone', async () => {
  expect((await call('owner', 'PATCH', `${S}/channels/general`, { nsfw: true, topic: 'Grown-ups only' })).body).toEqual({ nsfw: true, topic: 'Grown-ups only' });
  expect(await meta('owner', 'general')).toMatchObject({ nsfw: true, topic: 'Grown-ups only' });
  expect((await call('owner', 'PATCH', `${S}/channels/general`, { nsfw: false })).body).toEqual({ nsfw: false });
  expect(await meta('owner', 'general')).toMatchObject({ nsfw: false, topic: 'Grown-ups only' }); // the topic stays
});
