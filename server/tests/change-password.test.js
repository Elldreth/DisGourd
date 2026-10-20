// P6-02: change your password — the current one is checked, the new one follows
// the sign-up rules, and every other device is signed out (token versions, v25).
const WebSocket = require('ws');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

let serverModule;
let port;
const SECRET = 'disgourd-test-secret-0123456789abcdef';

beforeAll((done) => {
  process.env.PORT = 0;
  process.env.JWT_SECRET = SECRET;
  process.env.DB_PATH = ':memory:';
  process.env.UPLOADS_DIR = path.join(os.tmpdir(), `disgourd-test-uploads-password-${process.pid}`);
  serverModule = require('../server');
  serverModule.httpServer.listen(0, () => {
    port = serverModule.httpServer.address().port;
    done();
  });
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const sockets = [];

afterAll((done) => {
  for (const gw of sockets) gw.close();
  serverModule.httpServer.close(done);
});

const post = async (p, body, token) => {
  const res = await fetch(`http://localhost:${port}${p}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const get = async (p, token) => (await fetch(`http://localhost:${port}${p}`, { headers: { Authorization: `Bearer ${token}` } })).status;
const register = async (username, password = 'password123') =>
  (await post('/register', { username, password, email: `${username}@example.com` })).body.token;
const login = (username, password) => post('/login', { username, password });
const change = (token, currentPassword, newPassword) => post('/me/password', { currentPassword, newPassword }, token);

// A token signed like the server's, without a version: what clients hold from before v25.
function legacyToken(userId, username) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const data = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: userId, name: username, iat: now, exp: now + 3600 })}`;
  return `${data}.${crypto.createHmac('sha256', SECRET).update(data).digest('base64url')}`;
}

function gateway(token) {
  const ws = new WebSocket(`ws://localhost:${port}/gateway?token=${token}`);
  const gw = { frames: [], closed: null, refused: false };
  ws.on('message', (raw) => gw.frames.push(JSON.parse(raw.toString())));
  ws.on('close', (code) => { gw.closed = code; });
  gw.ready = new Promise((resolve) => {
    ws.on('open', () => resolve(true));
    ws.on('error', () => { gw.refused = true; resolve(false); });
  });
  gw.close = () => ws.close();
  sockets.push(gw);
  return gw;
}

test('v25 adds the token version; tokens from before it (no version) still work', async () => {
  const { db } = serverModule;
  expect(db.raw.pragma('user_version', { simple: true })).toBe(25);
  await register('olduser');
  const id = db.getUserByUsername('olduser').id;
  expect(db.getTokenVersion(id)).toBe(0);
  expect(await get('/me', legacyToken(id, 'olduser'))).toBe(200);
  const gw = gateway(legacyToken(id, 'olduser'));
  expect(await gw.ready).toBe(true);
});

test('refusals: no token, wrong current password, bad new passwords', async () => {
  const token = await register('refuser');
  expect((await post('/me/password', { currentPassword: 'password123', newPassword: 'whatever123' })).status).toBe(401);
  const wrong = await change(token, 'not-my-password', 'brand-new-pass');
  expect(wrong.status).toBe(403);
  expect(wrong.body.error).toMatch(/current password is incorrect/i);
  expect((await change(token, 'password123', 'short')).status).toBe(400);
  expect((await change(token, 'password123', 'x'.repeat(201))).status).toBe(400);
  expect((await change(token, 'password123', 12345678)).status).toBe(400);
  const same = await change(token, 'password123', 'password123');
  expect(same.status).toBe(400);
  expect(same.body.error).toMatch(/different/i);
  // Nothing changed: the old password still signs in, the token still works.
  expect((await login('refuser', 'password123')).status).toBe(200);
  expect(await get('/me', token)).toBe(200);
});

test('a change: new password signs in, old does not; other devices are signed out; the returned token works', async () => {
  const { db } = serverModule;
  const tokenA = await register('changer'); // this device
  const tokenB = (await login('changer', 'password123')).body.token; // another device
  const id = db.getUserByUsername('changer').id;
  const legacy = legacyToken(id, 'changer');
  const gwA = gateway(tokenA);
  const gwB = gateway(tokenB);
  await gwA.ready;
  await gwB.ready;

  const res = await change(tokenA, 'password123', 'a-better-password');
  expect(res.status).toBe(200);
  expect(typeof res.body.token).toBe('string');
  expect(db.getTokenVersion(id)).toBe(1);
  await wait(150);

  // Passwords.
  expect((await login('changer', 'a-better-password')).status).toBe(200);
  expect((await login('changer', 'password123')).status).toBe(401);

  // Every older token is refused on HTTP; the new one works.
  for (const old of [tokenA, tokenB, legacy]) expect(await get('/me', old)).toBe(401);
  expect(await get('/me', res.body.token)).toBe(200);

  // Open sockets were told and closed; an old token can't reconnect; the new one can.
  for (const gw of [gwA, gwB]) {
    expect(gw.frames.some((f) => f.type === 'signed_out' && f.reason === 'password_changed')).toBe(true);
    expect(gw.closed).toBe(4001);
  }
  const again = gateway(tokenB);
  expect(await again.ready).toBe(false);
  const fresh = gateway(res.body.token);
  expect(await fresh.ready).toBe(true);
});

test('a second change keeps the newest token working and stops the one before it', async () => {
  const first = await register('twice');
  const t1 = (await change(first, 'password123', 'second-password')).body.token;
  const gw = gateway(t1);
  expect(await gw.ready).toBe(true);
  const t2 = (await change(t1, 'second-password', 'third-password')).body.token;
  await wait(100);
  expect(await get('/me', t1)).toBe(401);
  expect(await get('/me', t2)).toBe(200);
  expect(gw.closed).toBe(4001);
});

test('the 11th try within 15 minutes is refused with 429', async () => {
  const token = await register('guesser');
  const { config } = require('../config'); // tests run with rate limits off; on for this one
  config.rateLimit = true;
  try {
    for (let i = 0; i < 10; i += 1) expect((await change(token, `guess-${i}-wrong`, 'new-password-1')).status).toBe(403);
    expect((await change(token, 'password123', 'new-password-1')).status).toBe(429);
  } finally {
    config.rateLimit = false;
  }
});
