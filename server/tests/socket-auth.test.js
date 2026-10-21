// P11-07: the session token stays out of URLs. The socket opens without one
// and signs in with its first frame ({ op: 'auth', token }) within a few
// seconds; HTTP routes take the token from the Authorization header only; and
// the upgrade refuses a browser Origin from another site.
const WebSocket = require('ws');
const os = require('os');
const path = require('path');

let serverModule;
let gatewayAuth;
let port;
let token;

beforeAll(async () => {
  process.env.PORT = 0;
  process.env.JWT_SECRET = 'disgourd-test-secret-0123456789abcdef';
  process.env.DB_PATH = ':memory:';
  process.env.UPLOADS_DIR = path.join(os.tmpdir(), `disgourd-test-uploads-socket-auth-${process.pid}`);
  serverModule = require('../server');
  ({ gatewayAuth } = require('../gateway'));
  await new Promise((r) => serverModule.httpServer.listen(0, r));
  port = serverModule.httpServer.address().port;
  const res = await fetch(`http://localhost:${port}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'sockauth', password: 'gourd-test-pass-1', email: 'sockauth@example.com' }),
  });
  token = (await res.json()).token;
});
afterAll((done) => {
  delete process.env.ALLOWED_ORIGINS;
  serverModule.wss.clients.forEach((c) => c.terminate());
  serverModule.httpServer.close(done);
  serverModule.httpServer.closeAllConnections();
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function open(query = '', headers = {}) {
  const ws = new WebSocket(`ws://localhost:${port}/gateway${query}`, { headers });
  const frames = [];
  ws.on('message', (raw) => frames.push(JSON.parse(raw.toString())));
  ws.on('error', () => {});
  const opened = new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('unexpected-response', (req, res) => {
      req.destroy();
      reject(Object.assign(new Error('refused'), { status: res.statusCode }));
    });
    ws.on('close', () => reject(new Error('closed')));
  });
  opened.catch(() => {});
  const closed = new Promise((resolve) => ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() })));
  return { ws, frames, opened, closed, send: (o) => ws.send(JSON.stringify(o)) };
}
async function until(check, ms = 2000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await wait(20);
  }
  return false;
}

test('no token in the URL: nothing is sent until the auth frame, then the usual connect frames', async () => {
  const s = open();
  await s.opened;
  s.send({ op: 'focus', space: 'x', channel: 'y' }); // ignored before auth
  await wait(150);
  expect(s.frames).toEqual([]);
  s.send({ op: 'auth', token });
  expect(await until(() => s.frames.some((f) => f.type === 'dm_unread'))).toBe(true);
  expect(s.frames.map((f) => f.type).slice(0, 3)).toEqual(['ready', 'unread', 'dm_unread']);
  s.ws.close();
});

test('a bad token in the auth frame closes with 4001', async () => {
  const s = open();
  await s.opened;
  s.send({ op: 'auth', token: 'not-a-token' });
  expect(await s.closed).toEqual({ code: 4001, reason: 'Sign in again' });
  expect(s.frames).toEqual([]);
});

test('no auth frame in time: closed with 4001', async () => {
  const before = gatewayAuth.timeoutMs;
  gatewayAuth.timeoutMs = 200;
  try {
    const s = open();
    await s.opened;
    expect((await s.closed).code).toBe(4001);
  } finally {
    gatewayAuth.timeoutMs = before;
  }
});

test('the old ?token= upgrade still works for one release', async () => {
  const s = open(`?token=${token}`);
  await s.opened;
  expect(await until(() => s.frames.some((f) => f.type === 'ready'))).toBe(true);
  s.ws.close();
});

test('unauthenticated sockets waiting to sign in are capped per address', async () => {
  const before = gatewayAuth.maxPendingPerIp;
  gatewayAuth.maxPendingPerIp = 2;
  const socks = [];
  try {
    socks.push(open(), open());
    await Promise.all(socks.map((s) => s.opened));
    const third = open();
    await expect(third.opened).rejects.toMatchObject({ status: 429 });
    // Signing one in frees its place.
    socks[0].send({ op: 'auth', token });
    await until(() => socks[0].frames.length > 0);
    const fourth = open();
    socks.push(fourth);
    await fourth.opened;
  } finally {
    gatewayAuth.maxPendingPerIp = before;
    socks.forEach((s) => s.ws.close());
  }
});

test('Origin: another site is refused; this host, a listed origin and no Origin are allowed', async () => {
  await expect(open('', { Origin: 'https://evil.example' }).opened).rejects.toMatchObject({ status: 403 });
  const same = open('', { Origin: `http://localhost:${port}` });
  await same.opened;
  same.ws.close();
  process.env.ALLOWED_ORIGINS = 'https://app.example.org';
  const listed = open('', { Origin: 'https://app.example.org' });
  await listed.opened;
  listed.ws.close();
  delete process.env.ALLOWED_ORIGINS;
  const none = open();
  await none.opened;
  none.ws.close();
});

test('HTTP: a token in the query string is not accepted, only the Authorization header', async () => {
  expect((await fetch(`http://localhost:${port}/me?token=${token}`)).status).toBe(401);
  expect((await fetch(`http://localhost:${port}/me`, { headers: { Authorization: `Bearer ${token}` } })).status).toBe(200);
});
