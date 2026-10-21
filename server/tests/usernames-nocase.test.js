// P11-12: usernames and emails are unique whatever the case, and every lookup
// ignores case: `Sandy` can't be registered next to `sandy`, `SANDY` signs in
// as sandy, and `@Sandy` mentions her. The stored spelling is what's shown.
const WebSocket = require('ws');
const os = require('os');
const path = require('path');

let serverModule;
let db;
let port;
const PASSWORD = 'amber-lantern-orbit-58';

beforeAll(async () => {
  process.env.PORT = 0;
  process.env.JWT_SECRET = 'disgourd-test-secret-0123456789abcdef';
  process.env.DB_PATH = ':memory:';
  process.env.UPLOADS_DIR = path.join(os.tmpdir(), `disgourd-test-uploads-nocase-${process.pid}`);
  serverModule = require('../server');
  db = serverModule.db;
  await new Promise((r) => serverModule.httpServer.listen(0, r));
  port = serverModule.httpServer.address().port;
});
afterAll((done) => {
  serverModule.wss.clients.forEach((c) => c.terminate());
  serverModule.httpServer.close(done);
  serverModule.httpServer.closeAllConnections();
});

const base = () => `http://localhost:${port}`;
const post = async (p, body) => {
  const res = await fetch(`${base()}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const register = (username, email = `${username.toLowerCase()}@example.com`) => post('/register', { username, password: PASSWORD, email });
const me = async (token) => (await fetch(`${base()}/me`, { headers: { Authorization: `Bearer ${token}` } })).json();

test('registering Sandy next to sandy, or her email in other capitals, is refused', async () => {
  expect((await register('sandy')).status).toBe(201);
  // P13-04: only a confirmed address blocks a sign-up, so sandy's is confirmed.
  db.raw.prepare('UPDATE users SET email_verified_at = ? WHERE username = ?').run(Date.now(), 'sandy');
  expect(await register('Sandy', 'other@example.com')).toEqual({ status: 409, body: { error: 'That username or email can’t be used' } });
  expect((await register('sandra', 'SANDY@Example.com')).status).toBe(409);
});

test('signing in as SANDY is sandy, shown with her own spelling', async () => {
  const res = await post('/login', { username: 'SANDY', password: PASSWORD });
  expect(res.status).toBe(200);
  expect((await me(res.body.token)).username).toBe('sandy');
  expect(db.getUserByUsername('SaNdY').username).toBe('sandy');
  expect(db.getUserByEmail('Sandy@EXAMPLE.com').username).toBe('sandy');
});

test('@Sandy in a message mentions sandy, once even if written twice', async () => {
  const author = await register('quinn');
  const space = db.createSpaceWithDefaults('Mentions', db.getUserByUsername('quinn').id);
  db.addMember(space, db.getUserByUsername('sandy').id, 'member');
  const ws = new WebSocket(`ws://localhost:${port}/gateway`);
  const frames = [];
  ws.on('message', (raw) => frames.push(JSON.parse(raw.toString())));
  await new Promise((r) => ws.on('open', r));
  ws.send(JSON.stringify({ op: 'auth', token: author.body.token }));
  await new Promise((r) => setTimeout(r, 100));
  ws.send(JSON.stringify({ op: 'message', space: 'Mentions', channel: 'general', content: 'hey @Sandy and @SANDY' }));
  await new Promise((r) => setTimeout(r, 200));
  const msg = frames.find((f) => f.type === 'message');
  expect(msg.mentions).toEqual(['sandy']);
  expect(db.raw.prepare('SELECT COUNT(*) AS n FROM mentions WHERE message_id = ?').get(msg.id).n).toBe(1);
  ws.close();
});

test('SITE_ADMINS matches whatever the case', async () => {
  await register('ivo');
  require('../config').applySiteAdmins(['IVO']);
  expect(db.isSiteAdmin(db.getUserByUsername('ivo').id)).toBe(true);
});
