// P9-03: signed-in devices — sessions made at sign-in with a device label,
// the list, signing out one device or all others, logout, older tokens
// without a session, and the sockets of a signed-out device.
const WebSocket = require('ws');
const os = require('os');
const path = require('path');

let serverModule;
let port;

beforeAll((done) => {
  process.env.PORT = 0;
  process.env.JWT_SECRET = 'disgourd-test-secret-0123456789abcdef';
  process.env.DB_PATH = ':memory:';
  process.env.UPLOADS_DIR = path.join(os.tmpdir(), `disgourd-test-uploads-sessions-${process.pid}`);
  serverModule = require('../server');
  serverModule.httpServer.listen(0, () => {
    port = serverModule.httpServer.address().port;
    done();
  });
});
afterAll((done) => {
  serverModule.httpServer.close(done);
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = {
  chromeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36',
  safariPhone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0',
};
const post = async (p, body, { token, ua } = {}) => {
  const res = await fetch(`http://localhost:${port}${p}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(ua ? { 'user-agent': ua } : {}) },
    body: JSON.stringify(body || {}),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const call = async (token, method, p) => {
  const res = await fetch(`http://localhost:${port}${p}`, { method, headers: { Authorization: `Bearer ${token}` } });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const login = async (ua) => (await post('/login', { username: 'dana', password: 'password123' }, { ua })).body.token;
const sessions = async (token) => (await call(token, 'GET', '/me/sessions')).body;
const works = async (token) => (await call(token, 'GET', '/me')).status === 200;
function gateway(token) {
  const ws = new WebSocket(`ws://localhost:${port}/gateway?token=${token}`);
  const frames = [];
  let closed = null;
  ws.on('message', (raw) => frames.push(JSON.parse(raw.toString())));
  ws.on('close', (code) => { closed = code; });
  const ready = new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject); });
  return { frames, ready, closed: () => closed, close: () => ws.close() };
}

let first; // the registration's token (Chrome on Windows)
beforeAll(async () => {
  first = (await post('/register', { username: 'dana', password: 'password123', email: 'dana@example.com' }, { ua: UA.chromeWin })).body.token;
});

test('device labels come from the User-Agent', () => {
  const { deviceLabel } = require('../auth/device');
  expect(deviceLabel(UA.chromeWin)).toBe('Chrome on Windows');
  expect(deviceLabel(UA.safariPhone)).toBe('Safari on iPhone');
  expect(deviceLabel(UA.firefoxLinux)).toBe('Firefox on Linux');
  expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/129.0 Safari/537.36 Edg/129.0')).toBe('Edge on Windows');
  expect(deviceLabel('')).toBe('Unknown device');
});

test('each sign-in is a device; the list marks this one, newest activity first', async () => {
  const phone = await login(UA.safariPhone);
  const list = await sessions(phone);
  expect(list.olderSignIns).toBe(false);
  expect(list.sessions.map((s) => s.device).sort()).toEqual(['Chrome on Windows', 'Safari on iPhone']);
  expect(list.sessions.find((s) => s.current).device).toBe('Safari on iPhone');
  expect(list.sessions.filter((s) => s.current)).toHaveLength(1);
  expect(list.sessions.every((s) => typeof s.createdAt === 'number' && typeof s.lastSeenAt === 'number')).toBe(true);
  expect(JSON.stringify(list)).not.toMatch(/Mozilla|127\.0\.0\.1|::1/); // no User-Agent or IP kept
});

test('signing out another device ends its token and closes its sockets; not your own; not someone else’s', async () => {
  const laptop = await login(UA.firefoxLinux);
  const phone = await login(UA.safariPhone);
  const gw = gateway(laptop);
  await gw.ready;
  await wait(100);
  const laptopId = (await sessions(phone)).sessions.find((s) => s.device === 'Firefox on Linux').id;
  const mine = (await sessions(phone)).sessions.find((s) => s.current).id;
  expect((await call(phone, 'DELETE', `/me/sessions/${mine}`)).status).toBe(400);
  expect((await call(phone, 'DELETE', '/me/sessions/not-a-session')).status).toBe(404);
  expect((await call(phone, 'DELETE', `/me/sessions/${laptopId}`)).status).toBe(200);
  await wait(150);
  expect(gw.frames).toContainEqual({ type: 'signed_out', reason: 'device' });
  expect(gw.closed()).toBe(4001);
  expect(await works(laptop)).toBe(false);
  expect(await works(phone)).toBe(true);
  // Another account can't sign out dana's devices.
  const other = (await post('/register', { username: 'eli', password: 'password123', email: 'eli@example.com' })).body.token;
  const phoneId = (await sessions(phone)).sessions.find((s) => s.current).id;
  expect((await call(other, 'DELETE', `/me/sessions/${phoneId}`)).status).toBe(404);
  expect(await works(phone)).toBe(true);
});

test('sign out all others: a fresh token for this device; every other token stops, older ones too', async () => {
  const { createToken } = require('../auth/tokens');
  const a = await login(UA.chromeWin);
  const b = await login(UA.safariPhone);
  const older = createToken(serverModule.db.getUserByUsername('dana').id, 'dana'); // no session: from before this change
  expect(await works(older)).toBe(true);
  const gwB = gateway(b);
  await gwB.ready;
  await wait(100);
  const res = await post('/me/sessions/sign-out-others', {}, { token: a });
  expect(res.status).toBe(200);
  const fresh = res.body.token;
  await wait(150);
  expect(await works(fresh)).toBe(true);
  expect(await works(b)).toBe(false);
  expect(await works(older)).toBe(false);
  expect(await works(first)).toBe(false);
  expect(gwB.frames).toContainEqual({ type: 'signed_out', reason: 'signed_out_elsewhere' });
  const list = await sessions(fresh);
  expect(list.sessions).toHaveLength(1);
  expect(list.sessions[0]).toMatchObject({ device: 'Chrome on Windows', current: true });
});

test('log out ends this device’s session; an older token without one just succeeds', async () => {
  const t = await login(UA.firefoxLinux);
  const before = (await sessions(t)).sessions.length;
  expect((await post('/logout', {}, { token: t })).status).toBe(200);
  expect(await works(t)).toBe(false);
  const another = await login(UA.chromeWin);
  expect((await sessions(another)).sessions.length).toBe(before); // -1 (logged out) +1 (this sign-in)
  expect((await post('/logout', {})).status).toBe(200);
});

test('last seen updates at most every few minutes', async () => {
  const { db } = serverModule;
  const t = await login(UA.chromeWin);
  const sid = JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).sid;
  db.raw.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(Date.now() - 60e3, sid);
  await works(t);
  expect(db.getSession(sid).lastSeenAt).toBeLessThan(Date.now() - 50e3); // one minute ago: not touched
  db.raw.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(Date.now() - 10 * 60e3, sid);
  await works(t);
  expect(db.getSession(sid).lastSeenAt).toBeGreaterThan(Date.now() - 5e3);
});

test('changing the password keeps this device and ends the others’ sessions', async () => {
  const keep = await login(UA.chromeWin);
  await login(UA.safariPhone);
  const res = await post('/me/password', { currentPassword: 'password123', newPassword: 'password456' }, { token: keep });
  expect(res.status).toBe(200);
  const list = await sessions(res.body.token);
  expect(list.sessions).toHaveLength(1);
  expect(list.sessions[0]).toMatchObject({ current: true, device: 'Chrome on Windows' });
});

test('your open windows are told when a device signs in or out, so the list can reload', async () => {
  // dana's password changed in the test above.
  const login = async (ua) => (await post('/login', { username: 'dana', password: 'password456' }, { ua })).body.token;
  const t = await login(UA.chromeWin);
  const gw = gateway(t);
  await gw.ready;
  await wait(100);
  const other = await login(UA.firefoxLinux);
  await wait(120);
  expect(gw.frames.filter((f) => f.type === 'sessions_changed')).toHaveLength(1);
  await post('/logout', {}, { token: other });
  await wait(120);
  expect(gw.frames.filter((f) => f.type === 'sessions_changed')).toHaveLength(2);
  gw.close();
});
