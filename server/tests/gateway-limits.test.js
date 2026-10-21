// P11-03: one signed-in member can't fill the disk or flood everyone: the
// `read` op only stores real, visible channels; ops are rate limited per
// person; at most 10 sockets each; searches are limited; a socket that keeps
// flooding is closed.
const WebSocket = require('ws');
const os = require('os');
const path = require('path');

let serverModule;
let db;
let port;
const users = {};
const SPACE = 'Limits';

beforeAll((done) => {
  process.env.PORT = 0;
  process.env.JWT_SECRET = 'disgourd-test-secret-0123456789abcdef';
  process.env.DB_PATH = ':memory:';
  process.env.UPLOADS_DIR = path.join(os.tmpdir(), `disgourd-test-uploads-limits-${process.pid}`);
  serverModule = require('../server');
  db = serverModule.db;
  serverModule.httpServer.listen(0, () => {
    port = serverModule.httpServer.address().port;
    done();
  });
});
afterAll((done) => {
  serverModule.config.rateLimit = false;
  serverModule.wss.clients.forEach((c) => c.terminate());
  serverModule.httpServer.close(done);
  serverModule.httpServer.closeAllConnections();
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
function gateway(token) {
  const ws = new WebSocket(`ws://localhost:${port}/gateway?token=${token}`);
  const frames = [];
  ws.on('message', (raw) => frames.push(JSON.parse(raw.toString())));
  ws.on('error', () => {});
  const ready = new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('unexpected-response', (req, res) => {
      req.destroy(); // handling it ourselves means aborting it too (ws docs)
      reject(Object.assign(new Error('refused'), { status: res.statusCode }));
    });
    ws.on('close', () => reject(new Error('closed')));
  });
  const closed = new Promise((resolve) => ws.on('close', (code) => resolve(code)));
  return { ws, frames, ready, closed, send: (o) => ws.send(JSON.stringify(o)), close: () => ws.close() };
}

beforeAll(async () => {
  // Users are made before the limits go on (sign-up has its own per-IP limit).
  for (const name of ['owner', 'ann', 'ben', 'cat', 'dan', 'eve']) {
    const token = await register(name);
    users[name] = { token, id: db.getUserByUsername(name).id };
  }
  const spaceId = db.createSpaceWithDefaults(SPACE, users.owner.id);
  for (const n of ['ann', 'ben', 'cat', 'dan', 'eve']) db.addMember(spaceId, users[n].id, 'member');
  db.createSpaceWithDefaults('Elsewhere', users.owner.id); // ann isn't a member
  serverModule.config.rateLimit = true; // the limits are off in other suites
});

test('`read` stores only channels you can see: not made-up names, other servers or huge strings', async () => {
  const g = gateway(users.ann.token);
  await g.ready;
  const rows = () => db.raw.prepare('SELECT space, channel FROM read_state WHERE user_id = ?').all(users.ann.id);
  const big = 'x'.repeat(100 * 1024);
  g.send({ op: 'read', space: big, channel: big, lastId: 1 });
  g.send({ op: 'read', space: SPACE, channel: 'no-such-channel', lastId: 1 });
  g.send({ op: 'read', space: 'Elsewhere', channel: 'general', lastId: 1 });
  g.send({ op: 'read', space: SPACE, channel: 'general', lastId: 99999999999999999999 });
  await wait(150);
  expect(rows()).toEqual([{ space: SPACE, channel: 'general' }]);
  const { last_read_id: lastId } = db.raw.prepare('SELECT last_read_id FROM read_state WHERE user_id = ?').get(users.ann.id);
  expect(Number.isSafeInteger(lastId)).toBe(true);
  g.close();
});

test('50 messages in a second: at most 10 are stored, and the sender hears RATE_LIMITED', async () => {
  const g = gateway(users.ben.token);
  await g.ready;
  const before = db.raw.prepare('SELECT COUNT(*) AS n FROM messages WHERE author_id = ?').get(users.ben.id).n;
  for (let i = 0; i < 50; i += 1) g.send({ op: 'message', space: SPACE, channel: 'general', content: `spam ${i}` });
  await wait(300);
  const stored = db.raw.prepare('SELECT COUNT(*) AS n FROM messages WHERE author_id = ?').get(users.ben.id).n - before;
  expect(stored).toBeLessThanOrEqual(10);
  expect(stored).toBeGreaterThan(0);
  const limited = g.frames.filter((f) => f.type === 'error' && f.code === 'RATE_LIMITED');
  expect(limited.length).toBeGreaterThan(0);
  expect(limited[0]).toMatchObject({ op: 'message', space: SPACE, channel: 'general' });
  expect(limited[0].retryAfter).toBeGreaterThanOrEqual(1);
  expect(limited.length).toBeLessThanOrEqual(5); // refusals are told about, not echoed 40 times
  g.close();
});

test('typing past once a second is dropped quietly', async () => {
  const g = gateway(users.cat.token);
  await g.ready;
  for (let i = 0; i < 20; i += 1) g.send({ op: 'typing', space: SPACE, channel: 'general' });
  await wait(150);
  expect(g.frames.filter((f) => f.type === 'error')).toEqual([]);
  g.close();
});

test('at most 10 sockets per person: the 11th is refused, the first 10 keep working', async () => {
  const socks = [];
  for (let i = 0; i < 10; i += 1) {
    const g = gateway(users.dan.token);
    await g.ready;
    socks.push(g);
  }
  const eleventh = gateway(users.dan.token);
  await expect(eleventh.ready).rejects.toMatchObject({ status: 429 });
  eleventh.ws.terminate();
  socks[0].send({ op: 'message', space: SPACE, channel: 'general', content: 'still here' });
  await wait(150);
  expect(socks[9].frames.some((f) => f.type === 'message' && f.content === 'still here')).toBe(true);
  socks.forEach((g) => g.close());
  await wait(100);
});

test('the 11th search in a minute answers 429', async () => {
  const search = () => fetch(`${base()}/search?q=spam`, { headers: { Authorization: `Bearer ${users.eve.token}` } });
  for (let i = 0; i < 10; i += 1) expect((await search()).status).toBe(200);
  const res = await search();
  expect(res.status).toBe(429);
  expect((await res.json()).error).toMatch(/too many searches/i);
});

test('a socket that keeps flooding is closed (1008)', async () => {
  const g = gateway(users.eve.token);
  await g.ready;
  for (let i = 0; i < 1700; i += 1) g.send({ op: 'focus', space: SPACE, channel: 'general' });
  const code = await Promise.race([g.closed, wait(3000).then(() => 'still open')]);
  g.ws.terminate();
  expect(code).toBe(1008);
});
