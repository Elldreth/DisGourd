// P12-03: "Forgot password?" emails a one-time link to a confirmed address;
// the link sets a new password and signs out every device. Site admins can
// make a 24-hour link for someone, and the console tool makes one for anyone.
const os = require('os');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const WebSocket = require('ws');

const MAIL_ENV = { SMTP_HOST: 'smtp.example.com', SMTP_PORT: '587', SMTP_USER: 'resend', SMTP_PASS: 'pw-1234567890', MAIL_FROM: 'DisGourd <no-reply@example.com>', PUBLIC_URL: 'https://chat.example.com' };
const PASS = 'gourd-test-pass-1';
const NEW_PASS = 'squash-harvest-42';

let serverModule;
let port;
let db;
let mail;
let rateLimit;
const outbox = [];
const fakeTransport = { sendMail: async (m) => { outbox.push(m); return {}; } };
const mailOn = () => Object.assign(process.env, MAIL_ENV);
const mailOff = () => { for (const k of Object.keys(MAIL_ENV)) delete process.env[k]; };
const sockets = [];
let warnSpy;

beforeAll(async () => {
  process.env.PORT = 0;
  process.env.JWT_SECRET = 'disgourd-test-secret-0123456789abcdef';
  process.env.DB_PATH = ':memory:';
  process.env.UPLOADS_DIR = path.join(os.tmpdir(), `disgourd-test-uploads-reset-${process.pid}`);
  mailOff();
  serverModule = require('../server');
  db = serverModule.db;
  mail = require('../mail');
  rateLimit = require('../auth/rateLimit');
  mail._setTransport(fakeTransport);
  await new Promise((r) => serverModule.httpServer.listen(0, r));
  port = serverModule.httpServer.address().port;
});
afterAll((done) => {
  for (const ws of sockets) ws.close();
  mailOff();
  mail._setTransport(null);
  serverModule.httpServer.close(done);
});
beforeEach(() => {
  mailOn();
  mail._reset();
  mail._setTransport(fakeTransport);
  outbox.length = 0;
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => warnSpy.mockRestore());

const base = () => `http://localhost:${port}`;
const call = (token, method, p, body) => fetch(`${base()}${p}`, {
  method,
  headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
});
const json = async (res) => { const r = await res; return { status: r.status, body: await r.json() }; };
const register = async (username, email) => (await json(await call(null, 'POST', '/register', { username, password: PASS, ...(email ? { email } : {}) }))).body.token;
const confirmAddress = (username) => db.raw.prepare('UPDATE users SET email_verified_at = ? WHERE username = ?').run(Date.now(), username);
const forgot = (login) => json(call(null, 'POST', '/password/forgot', { login }));
const reset = (token, newPassword) => json(call(null, 'POST', '/password/reset', { token, newPassword }));
const login = (username, password) => call(null, 'POST', '/login', { username, password });
const until = async (fn, ms = 2000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 10));
  }
};
const resetTokenIn = (m) => /#reset=([A-Za-z0-9_-]+)/.exec(m.text)[1];
const logged = () => warnSpy.mock.calls.map((c) => c.join(' ')).join('\n');

function gateway(token) {
  const ws = new WebSocket(`ws://localhost:${port}/gateway?token=${token}`);
  const gw = { frames: [], closed: null };
  ws.on('message', (raw) => gw.frames.push(JSON.parse(raw.toString())));
  ws.on('close', (code) => { gw.closed = code; });
  gw.ready = new Promise((resolve) => {
    ws.on('open', () => resolve(true));
    ws.on('error', () => resolve(false));
  });
  sockets.push(ws);
  return gw;
}

let owner;
beforeAll(async () => {
  mailOn();
  owner = await register('owner', 'owner@example.com'); // the first account: a site admin
  confirmAddress('owner');
  await register('ruth', 'ruth@example.com');
  confirmAddress('ruth');
  await register('una', 'una@example.com'); // never confirmed
  await register('noel'); // no address
  await register('mod'); // made a site admin below
  db.raw.prepare('UPDATE users SET site_admin = 1 WHERE username = ?').run('mod');
});

test('the forgot answer is the same for a confirmed address, an unconfirmed one, none, and nobody', async () => {
  const answers = [];
  for (const who of ['ruth', 'RUTH@example.com', 'una', 'una@example.com', 'noel', 'nobody', 'nobody@example.com', '']) {
    const started = Date.now();
    const r = await forgot(who);
    answers.push(r);
    expect(Date.now() - started).toBeGreaterThanOrEqual(380); // everyone waits about as long
  }
  for (const r of answers) expect(r).toEqual({ status: 200, body: { ok: true, message: 'If that account has a confirmed email, a reset link is on its way. It expires in 30 minutes.' } });
  // Only ruth's confirmed address got mail (twice: by name and by address).
  await until(() => outbox.length === 2);
  await new Promise((r) => setTimeout(r, 50));
  expect(outbox.map((m) => m.to)).toEqual(['ruth@example.com', 'ruth@example.com']);
  expect(outbox[0].subject).toBe('Reset your DisGourd password');
  expect(outbox[0].text).toContain('https://chat.example.com/#reset=');
  // The second link replaced the first.
  expect((await reset(resetTokenIn(outbox[0]), NEW_PASS)).body.code).toBe('TOKEN_INVALID');
  // Logs name the account and the address's domain, never the token or the address.
  expect(logged()).toContain('…@example.com');
  expect(logged()).not.toContain('ruth@example.com');
  expect(logged()).not.toContain(resetTokenIn(outbox[1]));
});

test('with email off, nothing is sent and the answer is the same', async () => {
  mailOff();
  expect((await forgot('ruth')).status).toBe(200);
  await new Promise((r) => setTimeout(r, 50));
  expect(outbox).toHaveLength(0);
});

test('the link sets a new password once, signs out every device, and signs this one in', async () => {
  const before = (await json(await login('ruth', PASS))).body.token;
  const gw = gateway(before);
  expect(await gw.ready).toBe(true);
  await forgot('ruth');
  await until(() => outbox.length === 1);
  const token = resetTokenIn(outbox[0]);

  // Weak or mismatched passwords are refused without spending the link.
  expect((await reset(token, 'short')).status).toBe(400);
  expect((await reset(token, 'password123')).status).toBe(400);
  expect((await reset('x'.repeat(43), NEW_PASS)).body).toEqual({ error: 'This link has expired or was already used', code: 'TOKEN_INVALID' });

  const done = await reset(token, NEW_PASS);
  expect(done.status).toBe(200);
  expect(done.body.ok).toBe(true);
  expect(typeof done.body.token).toBe('string');
  // The old device is out, live and over HTTP; the new token works.
  await until(() => gw.closed !== null);
  expect(gw.closed).toBe(4001);
  expect(gw.frames.some((f) => f.type === 'signed_out')).toBe(true);
  expect((await call(before, 'GET', '/me')).status).toBe(401);
  expect((await call(done.body.token, 'GET', '/me')).status).toBe(200);
  expect((await login('ruth', PASS)).status).toBe(401);
  expect((await login('ruth', NEW_PASS)).status).toBe(200);
  // Once only.
  expect((await reset(token, 'another-good-one-7')).body.code).toBe('TOKEN_INVALID');
  expect(logged()).not.toContain(token);
});

test('a link expires', async () => {
  const id = db.getUserByUsername('noel').id;
  const raw = db.createEmailToken(id, 'reset', null, 60 * 1000);
  db.raw.prepare('UPDATE email_tokens SET expires_at = ? WHERE user_id = ? AND used_at IS NULL').run(Date.now() - 1, id);
  expect((await reset(raw, NEW_PASS)).body.code).toBe('TOKEN_INVALID');
  // A confirm-email token isn't a reset token either.
  const confirm = db.createEmailToken(id, 'confirm', 'noel@example.com', 60 * 1000);
  expect((await reset(confirm, NEW_PASS)).body.code).toBe('TOKEN_INVALID');
});

test('a suspended account gets its new password but no sign-in', async () => {
  await register('sid');
  const id = db.getUserByUsername('sid').id;
  db.raw.prepare('UPDATE users SET suspended_at = ? WHERE id = ?').run(Date.now(), id);
  const raw = db.createEmailToken(id, 'reset', null, 60 * 1000);
  expect(await reset(raw, NEW_PASS)).toEqual({ status: 200, body: { ok: true, suspended: true } });
});

test('a site admin makes a 24-hour link for an account, logged without the link', async () => {
  const r = await json(await call(owner, 'POST', '/admin/users/noel/reset-link'));
  expect(r.status).toBe(201);
  expect(r.body.expiresInHours).toBe(24);
  const token = /^\/#reset=([A-Za-z0-9_-]+)$/.exec(r.body.path)[1];
  const row = db.raw.prepare('SELECT expires_at - created_at AS ttl FROM email_tokens WHERE user_id = ? AND used_at IS NULL AND purpose = ?').get(db.getUserByUsername('noel').id, 'reset');
  expect(row.ttl).toBe(24 * 60 * 60 * 1000);
  expect(logged()).toContain('[admin] owner made a reset link for noel');
  expect(logged()).not.toContain(token);
  expect((await reset(token, NEW_PASS)).status).toBe(200);
  expect((await login('noel', NEW_PASS)).status).toBe(200);
});

test('only site admins make links, never for another site admin, and not for unknown names', async () => {
  const ruth = (await json(await login('ruth', NEW_PASS))).body.token;
  expect((await call(ruth, 'POST', '/admin/users/una/reset-link')).status).toBe(403);
  expect((await call(null, 'POST', '/admin/users/una/reset-link')).status).toBe(401);
  expect((await json(await call(owner, 'POST', '/admin/users/mod/reset-link')))).toEqual({ status: 403, body: { error: 'Site admins reset their own password (Forgot password, or the server console)' } });
  expect((await call(owner, 'POST', '/admin/users/ghost/reset-link')).status).toBe(404);
});

test('forgot is limited to 5 tries in 15 minutes from one address, and reset to 20', async () => {
  const { config } = require('../config');
  config.rateLimit = true;
  rateLimit._reset();
  try {
    for (let i = 0; i < 5; i += 1) expect((await forgot('nobody')).status).toBe(200);
    expect((await forgot('nobody')).status).toBe(429);
    for (let i = 0; i < 20; i += 1) expect((await reset('x'.repeat(43), NEW_PASS)).status).toBe(400);
    expect((await reset('x'.repeat(43), NEW_PASS)).status).toBe(429);
  } finally {
    config.rateLimit = false;
    rateLimit._reset();
  }
});

test('one account gets at most 3 reset emails an hour', async () => {
  const { config } = require('../config');
  config.rateLimit = true;
  rateLimit._reset();
  try {
    for (let i = 0; i < 4; i += 1) expect((await forgot('owner')).status).toBe(200); // within the 5 per IP
    await new Promise((r) => setTimeout(r, 100));
    expect(outbox.filter((m) => m.to === 'owner@example.com')).toHaveLength(3);
  } finally {
    config.rateLimit = false;
    rateLimit._reset();
  }
});

test('the console tool prints a one-time link for an account, and refuses unknown names', () => {
  const file = path.join(os.tmpdir(), `disgourd-reset-cli-${process.pid}.db`);
  const env = { ...process.env, DB_PATH: file, PUBLIC_URL: 'https://chat.example.com/' };
  const script = path.join(__dirname, '..', 'scripts', 'reset-link.js');
  try {
    execFileSync(process.execPath, ['-e', "require('./db').raw.prepare(\"INSERT INTO users(username, password_hash, salt) VALUES ('kim', 'h', 's')\").run()"], { cwd: path.join(__dirname, '..'), env });
    const out = execFileSync(process.execPath, [script, 'kim'], { env }).toString();
    expect(out).toMatch(/^A reset link for kim \(works once, for 24 hours\):\nhttps:\/\/chat\.example\.com\/#reset=[A-Za-z0-9_-]{43}\n$/);
    let failed;
    try {
      execFileSync(process.execPath, [script, 'ghost'], { env, stdio: 'pipe' });
    } catch (err) {
      failed = err;
    }
    expect(failed.status).toBe(1);
    expect(failed.stderr.toString()).toContain('No account named "ghost".');
  } finally {
    for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
  }
});
