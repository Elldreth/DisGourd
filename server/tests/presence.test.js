// P2-14: presence modes. You pick online / idle / dnd / invisible; others see
// your *effective* status: offline when you're disconnected or invisible,
// otherwise the mode.
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
  process.env.UPLOADS_DIR = path.join(os.tmpdir(), `disgourd-test-uploads-presence-${process.pid}`);
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

async function register(username) {
  const res = await fetch(`${base()}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'password123', email: `${username}@example.com` }),
  });
  return (await res.json()).token;
}
async function connect(name) {
  const u = users[name];
  u.frames = [];
  u.gw = new WebSocket(`ws://localhost:${port}/gateway?token=${u.token}`);
  u.gw.on('message', (raw) => u.frames.push(JSON.parse(raw.toString())));
  await new Promise((r) => u.gw.on('open', r));
}
const patchMe = (name, body) =>
  fetch(`${base()}/me`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${users[name].token}` },
    body: JSON.stringify(body),
  });
const getMe = async (name) => (await fetch(`${base()}/me`, { headers: { Authorization: `Bearer ${users[name].token}` } })).json();
async function membersAs(name) {
  const res = await fetch(`${base()}/spaces/Here/members`, { headers: { Authorization: `Bearer ${users[name].token}` } });
  return Object.fromEntries((await res.json()).members.map((m) => [m.username, m]));
}
const presenceOf = (watcher, who) => users[watcher].frames.filter((f) => f.type === 'presence' && f.user === who).at(-1);

beforeAll(async () => {
  const { db } = serverModule;
  for (const name of ['pat', 'quinn']) {
    const token = await register(name);
    users[name] = { token, id: db.getUserByUsername(name).id };
  }
  const spaceId = db.createSpaceWithDefaults('Here', users.pat.id);
  db.addMember(spaceId, users.quinn.id, 'member');
  await connect('quinn');
  await connect('pat');
  await wait(80);
});

test('everyone starts online, and the members list carries a status', async () => {
  expect((await getMe('pat')).presence).toBe('online');
  const m = await membersAs('quinn');
  expect(m.pat).toMatchObject({ status: 'online', online: true });
});

test('dnd: co-members see dnd', async () => {
  const res = await patchMe('pat', { presence: 'dnd' });
  expect(res.status).toBe(200);
  expect((await res.json()).presence).toBe('dnd');
  await wait(60);
  expect(presenceOf('quinn', 'pat').status).toBe('dnd');
  expect((await membersAs('quinn')).pat).toMatchObject({ status: 'dnd', online: true });
});

test('invisible: others see offline, but you still get everything', async () => {
  await patchMe('pat', { presence: 'invisible' });
  await wait(60);
  expect(presenceOf('quinn', 'pat').status).toBe('offline');
  expect((await membersAs('quinn')).pat).toMatchObject({ status: 'offline', online: false });
  // Your own other tabs learn your mode privately; nobody else sees "invisible".
  expect(users.pat.frames.filter((f) => f.type === 'my_presence').at(-1)).toEqual({ type: 'my_presence', mode: 'invisible' });
  expect(users.quinn.frames.some((f) => JSON.stringify(f).includes('invisible'))).toBe(false);
  // Still receives messages.
  users.quinn.gw.send(JSON.stringify({ op: 'message', space: 'Here', channel: 'general', content: 'hello?' }));
  await wait(80);
  expect(users.pat.frames.some((f) => f.type === 'message' && f.content === 'hello?')).toBe(true);
});

test('the mode survives a reconnect (invisible stays invisible)', async () => {
  users.pat.gw.close();
  await wait(80);
  const quinnSawBefore = users.quinn.frames.filter((f) => f.type === 'presence' && f.user === 'pat').length;
  await connect('pat');
  await wait(80);
  expect((await getMe('pat')).presence).toBe('invisible');
  expect((await membersAs('quinn')).pat.status).toBe('offline');
  // Coming back while invisible doesn't announce you as online.
  const after = users.quinn.frames.filter((f) => f.type === 'presence' && f.user === 'pat');
  expect(after.slice(quinnSawBefore).every((f) => f.status === 'offline')).toBe(true);
});

test('idle, and back to online', async () => {
  await patchMe('pat', { presence: 'idle' });
  await wait(60);
  expect(presenceOf('quinn', 'pat').status).toBe('idle');
  await patchMe('pat', { presence: 'online' });
  await wait(60);
  expect(presenceOf('quinn', 'pat').status).toBe('online');
});

test('a mode set while disconnected shows once you connect', async () => {
  users.quinn.gw.close();
  await wait(80);
  await patchMe('quinn', { presence: 'dnd' });
  expect((await membersAs('pat')).quinn.status).toBe('offline'); // not connected
  await connect('quinn');
  await wait(80);
  expect(presenceOf('pat', 'quinn').status).toBe('dnd');
});

test('an unknown mode is refused, and changing presence leaves your avatar alone', async () => {
  serverModule.db.setUserAvatar(users.pat.id, '/uploads/abc/me.png');
  expect((await patchMe('pat', { presence: 'busy' })).status).toBe(400);
  expect((await patchMe('pat', { presence: '' })).status).toBe(400);
  const ok = await patchMe('pat', { presence: 'dnd' });
  expect((await ok.json()).avatar).toBe('/uploads/abc/me.png');
});
