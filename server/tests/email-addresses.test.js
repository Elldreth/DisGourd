// P12-02: optional email addresses, confirmed by a one-time link, changed only
// with your password, and the site admin's "Require a confirmed email".
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const MAIL_ENV = { SMTP_HOST: 'smtp.example.com', SMTP_PORT: '587', SMTP_USER: 'resend', SMTP_PASS: 'pw-1234567890', MAIL_FROM: 'DisGourd <no-reply@example.com>', PUBLIC_URL: 'https://chat.example.com' };
const PASS = 'gourd-test-pass-1';

let serverModule;
let port;
let db;
let mail;
const outbox = [];
const fakeTransport = { sendMail: async (m) => { outbox.push(m); return {}; } };
const mailOn = () => Object.assign(process.env, MAIL_ENV);
const mailOff = () => { for (const k of Object.keys(MAIL_ENV)) delete process.env[k]; };

beforeAll(async () => {
  process.env.PORT = 0;
  process.env.JWT_SECRET = 'disgourd-test-secret-0123456789abcdef';
  process.env.DB_PATH = ':memory:';
  process.env.UPLOADS_DIR = path.join(os.tmpdir(), `disgourd-test-uploads-email-${process.pid}`);
  mailOff();
  serverModule = require('../server');
  db = serverModule.db;
  mail = require('../mail');
  mail._setTransport(fakeTransport);
  await new Promise((r) => serverModule.httpServer.listen(0, r));
  port = serverModule.httpServer.address().port;
});
afterAll((done) => {
  mailOff();
  mail._setTransport(null);
  serverModule.httpServer.close(done);
});
beforeEach(() => {
  mail._reset();
  mail._setTransport(fakeTransport);
  outbox.length = 0;
});

const base = () => `http://localhost:${port}`;
const call = (token, method, p, body) => fetch(`${base()}${p}`, {
  method,
  headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
});
const json = async (res) => ({ status: res.status, body: await res.json() });
const register = async (username, email) => json(await call(null, 'POST', '/register', { username, password: PASS, ...(email !== undefined ? { email } : {}) }));
const until = async (fn, ms = 2000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 10));
  }
};
// The token in the last confirmation email's link.
const lastLinkToken = () => /#confirm-email=([A-Za-z0-9_-]+)/.exec(outbox.at(-1).text)[1];

let owner;
test('sign-up without an email works; the first account is the site admin', async () => {
  const o = await register('owner', 'owner@example.com');
  expect(o.status).toBe(201);
  owner = o.body.token;
  const m = await register('nomail');
  expect(m.status).toBe(201);
  const empty = await register('blankmail', '  ');
  expect(empty.status).toBe(201);
  expect(db.getUserByUsername('nomail').email).toBeNull();
  expect((await json(await call(m.body.token, 'GET', '/me'))).body).toMatchObject({ email: null, emailVerified: false, emailPending: null, emailConfirmRequired: false });
  expect((await register('badmail', 'not-an-address')).body.error).toBe('Enter a valid email address, or leave it empty');
});

test('with email on, a new address gets a link; the link confirms it once, and its token is stored only as a hash', async () => {
  mailOn();
  const r = await register('cara', 'Cara@Example.com');
  expect(r.status).toBe(201);
  await until(() => outbox.length === 1);
  expect(outbox[0]).toMatchObject({ to: 'Cara@Example.com', subject: 'Confirm your email for DisGourd' });
  const token = lastLinkToken();
  expect(outbox[0].text).toContain(`https://chat.example.com/#confirm-email=${token}`);
  // Only the hash is kept.
  const rows = db.raw.prepare('SELECT token_hash, email, purpose FROM email_tokens WHERE user_id = ?').all(db.getUserByUsername('cara').id);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ purpose: 'confirm', email: 'Cara@Example.com' });
  expect(rows[0].token_hash).not.toContain(token);
  expect(JSON.stringify(db.raw.prepare('SELECT * FROM email_tokens').all())).not.toContain(token);
  expect((await json(await call(r.body.token, 'GET', '/me'))).body).toMatchObject({ email: 'Cara@Example.com', emailVerified: false, emailPending: 'Cara@Example.com' });
  // Confirmed (no sign-in needed), then the same link fails.
  expect(await json(await call(null, 'POST', '/email/confirm', { token }))).toEqual({ status: 200, body: { ok: true, email: 'Cara@Example.com' } });
  expect((await json(await call(r.body.token, 'GET', '/me'))).body).toMatchObject({ emailVerified: true, emailPending: null });
  expect(await json(await call(null, 'POST', '/email/confirm', { token }))).toEqual({ status: 400, body: { error: 'This link has expired or was already used', code: 'TOKEN_INVALID' } });
  expect((await call(null, 'POST', '/email/confirm', { token: 'x'.repeat(43) })).status).toBe(400);
});

test('changing the address needs your password, and it only changes when the link sent to the new one is used', async () => {
  mailOn();
  const r = await register('dan', 'dan@example.com');
  const t = r.body.token;
  expect((await json(await call(t, 'POST', '/me/email', { email: 'dan2@example.com', password: 'wrong-password-1' })))).toEqual({ status: 403, body: { error: 'Your password is incorrect' } });
  const changed = await json(await call(t, 'POST', '/me/email', { email: 'dan2@example.com', password: PASS }));
  expect(changed).toMatchObject({ status: 202, body: { email: 'dan@example.com', emailVerified: false, emailPending: 'dan2@example.com', sent: true } });
  expect(db.getUserByUsername('dan').email).toBe('dan@example.com'); // not yet
  await until(() => outbox.some((m) => m.to === 'dan2@example.com'));
  const link = lastLinkToken();
  // The earlier sign-up link no longer works once a new one is sent.
  const first = /#confirm-email=([A-Za-z0-9_-]+)/.exec(outbox.find((m) => m.to === 'dan@example.com').text)[1];
  expect((await call(null, 'POST', '/email/confirm', { token: first })).status).toBe(400);
  expect((await call(null, 'POST', '/email/confirm', { token: link })).status).toBe(200);
  expect(db.getUserByUsername('dan')).toMatchObject({ email: 'dan2@example.com' });
  expect(db.getUserByUsername('dan').email_verified_at).toBeGreaterThan(0);
});

test('an address someone else confirmed is refused with the same words as a bad one; an unconfirmed claim gives way', async () => {
  mailOn();
  const e = await register('eve');
  const bad = await json(await call(e.body.token, 'POST', '/me/email', { email: 'nope', password: PASS }));
  const taken = await json(await call(e.body.token, 'POST', '/me/email', { email: 'CARA@example.com', password: PASS }));
  expect(bad).toEqual({ status: 400, body: { error: 'That email address can’t be used' } });
  expect(taken).toEqual(bad);
  // fay registered with an address she never confirmed; gus confirms it: his wins, hers is cleared.
  await register('fay', 'shared@example.com');
  const g = await register('gus');
  outbox.length = 0;
  await call(g.body.token, 'POST', '/me/email', { email: 'shared@example.com', password: PASS });
  await until(() => outbox.length === 1);
  expect((await call(null, 'POST', '/email/confirm', { token: lastLinkToken() })).status).toBe(200);
  expect(db.getUserByUsername('gus').email).toBe('shared@example.com');
  expect(db.getUserByUsername('fay').email).toBeNull();
});

test('links expire after 24 hours; resend makes a fresh one; remove needs the password', async () => {
  mailOn();
  const h = await register('hal', 'hal@example.com');
  await until(() => outbox.length === 1);
  const old = lastLinkToken();
  db.raw.prepare('UPDATE email_tokens SET expires_at = ? WHERE user_id = ?').run(Date.now() - 1, db.getUserByUsername('hal').id);
  expect((await call(null, 'POST', '/email/confirm', { token: old })).status).toBe(400);
  expect((await json(await call(h.body.token, 'POST', '/me/email/resend'))).status).toBe(202);
  await until(() => outbox.length === 2);
  expect(lastLinkToken()).not.toBe(old);
  expect((await call(null, 'POST', '/email/confirm', { token: lastLinkToken() })).status).toBe(200);
  expect((await json(await call(h.body.token, 'POST', '/me/email/resend'))).body.error).toBe('There’s no address waiting to be confirmed');
  expect((await call(h.body.token, 'DELETE', '/me/email', { password: 'wrong-password-1' })).status).toBe(403);
  expect((await json(await call(h.body.token, 'DELETE', '/me/email', { password: PASS }))).body).toMatchObject({ email: null, emailVerified: false });
});

test('with email off, an address is kept unconfirmed and nothing is sent', async () => {
  mailOff();
  const i = await register('ivy');
  expect((await json(await call(i.body.token, 'POST', '/me/email', { email: 'ivy@example.com', password: PASS }))).body).toMatchObject({ email: 'ivy@example.com', emailVerified: false, sent: false });
  expect(outbox).toHaveLength(0);
});

test('"Require a confirmed email": only with email on; unconfirmed members reach only what confirms one; site admins never held back', async () => {
  mailOff();
  expect((await call(owner, 'PUT', '/admin/email', { requireConfirmed: true })).status).toBe(409);
  mailOn();
  const j = await register('jay'); // no address, before the switch
  expect((await call(j.body.token, 'PUT', '/admin/email', { requireConfirmed: true })).status).toBe(403);
  expect((await json(await call(owner, 'PUT', '/admin/email', { requireConfirmed: true }))).body.requireConfirmed).toBe(true);
  expect((await json(await call(null, 'GET', '/auth-info'))).body).toMatchObject({ email: true, emailRequired: true });
  // Sign-up now needs an address.
  expect((await register('kay')).body.error).toBe('An email address is required on this server');
  // jay: held back everywhere except the confirm path.
  const blocked = await json(await call(j.body.token, 'GET', '/spaces'));
  expect(blocked).toEqual({ status: 403, body: { error: 'Confirm your email address first', code: 'EMAIL_UNCONFIRMED' } });
  expect((await json(await call(j.body.token, 'GET', '/me'))).body).toMatchObject({ emailConfirmRequired: true });
  expect((await call(j.body.token, 'DELETE', '/me/email', { password: PASS })).status).toBe(409); // can't remove it now
  // The live connection is refused too.
  const closed = await new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${port}/gateway`);
    ws.on('open', () => ws.send(JSON.stringify({ op: 'auth', token: j.body.token })));
    ws.on('close', (code) => resolve(code));
  });
  expect(closed).toBe(4003);
  // The owner (a site admin, whose address isn't confirmed) isn't held back.
  expect((await call(owner, 'GET', '/spaces')).status).toBe(200);
  // jay adds and confirms an address: free again.
  outbox.length = 0;
  expect((await call(j.body.token, 'POST', '/me/email', { email: 'jay@example.com', password: PASS })).status).toBe(202);
  await until(() => outbox.length === 1);
  await call(null, 'POST', '/email/confirm', { token: lastLinkToken() });
  expect((await call(j.body.token, 'GET', '/spaces')).status).toBe(200);
  // Email going off lifts the hold (nobody could confirm anything).
  const l = await register('lou', 'lou@example.com');
  mailOff();
  expect((await call(l.body.token, 'GET', '/spaces')).status).toBe(200);
  mailOn();
  await call(owner, 'PUT', '/admin/email', { requireConfirmed: false });
});
