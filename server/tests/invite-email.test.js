// P14-03: "Email this invite": the creator (or a server manager) emails an
// invite link; no sender text; email must be on; limits; the template.
const os = require('os');
const path = require('path');

const PASS = 'gourd-test-pass-1';
const MAIL_ENV = { SMTP_HOST: 'smtp.example.com', SMTP_PORT: '587', SMTP_USER: 'u', SMTP_PASS: 'pw-1234567890', MAIL_FROM: 'DisGourd <no-reply@example.com>', PUBLIC_URL: 'https://chat.example.com' };
let serverModule;
let port;
let db;
let mail;
let templates;
let owner;
let mia;
let zed;
const outbox = [];
const mailOn = () => Object.assign(process.env, MAIL_ENV);
const mailOff = () => { for (const k of Object.keys(MAIL_ENV)) delete process.env[k]; };

beforeAll(async () => {
  process.env.PORT = 0;
  process.env.JWT_SECRET = 'disgourd-test-secret-0123456789abcdef';
  process.env.DB_PATH = ':memory:';
  process.env.UPLOADS_DIR = path.join(os.tmpdir(), `disgourd-test-uploads-invmail-${process.pid}`);
  mailOff();
  serverModule = require('../server');
  db = serverModule.db;
  mail = require('../mail');
  templates = require('../mail/templates');
  mail._setTransport({ sendMail: async (m) => { outbox.push(m); return {}; } });
  await new Promise((r) => serverModule.httpServer.listen(0, r));
  port = serverModule.httpServer.address().port;
  owner = (await register('owner')).body.token;
  mia = (await register('mia')).body.token;
  zed = (await register('zed')).body.token;
  await call(owner, 'POST', '/spaces', { name: 'Den' });
  await call(owner, 'POST', '/spaces', { name: 'Other' });
  const join = await invite(owner, 'Den');
  await call(mia, 'POST', `/invites/${join}`);
  await call(zed, 'POST', `/invites/${join}`);
});
afterAll((done) => {
  mailOff();
  mail._setTransport(null);
  serverModule.httpServer.close(done);
});
beforeEach(() => {
  mail._reset();
  outbox.length = 0;
});

const call = (token, method, p, body) => fetch(`http://localhost:${port}${p}`, {
  method,
  headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
});
const json = async (res) => ({ status: res.status, body: await res.json() });
const register = async (username) => json(await call(null, 'POST', '/register', { username, password: PASS }));
const invite = async (token, space, opts = {}) => (await json(await call(token, 'POST', `/spaces/${space}/invites`, opts))).body.code;
const emailIt = (token, space, code, to) => call(token, 'POST', `/spaces/${space}/invites/${code}/email`, { to });
const until = async (fn) => {
  const end = Date.now() + 2000;
  while (!fn()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
};

test('the creator emails an invite: the subject, the Join button to /invite/<code>, the expiry, and what a new person can do', async () => {
  mailOn();
  const code = await invite(owner, 'Den', { expiresInDays: 7 });
  expect(await json(await emailIt(owner, 'Den', code, ' friend@example.org '))).toEqual({ status: 202, body: { sent: true, to: 'friend@example.org' } });
  await until(() => outbox.length === 1);
  const m = outbox[0];
  expect(m).toMatchObject({ to: 'friend@example.org', subject: 'owner invited you to Den on DisGourd' });
  expect(m.text).toContain(`Join Den: https://chat.example.com/invite/${code}`);
  expect(m.text).toMatch(/This invite expires on [A-Z][a-z]+ \d{1,2}, \d{4}\./);
  // The site admin's invite can create accounts (the default policy), so it says so.
  expect(m.text).toContain('If you don’t have an account yet, the link lets you create one');
  expect(m.html).toContain(`href="https://chat.example.com/invite/${code}"`);
  // A never-expiring invite from someone whose links can't create accounts.
  const forever = await invite(mia, 'Den', { expiresInDays: null });
  await emailIt(mia, 'Den', forever, 'pal@example.org');
  await until(() => outbox.length === 2);
  expect(outbox[1].text).toContain('This invite doesn’t expire.');
  expect(outbox[1].text).toContain('Sign in with your account, and the link adds you to Den.');
});

test('only the creator or a server manager; a used-up or another server’s invite; email off; a bad address', async () => {
  mailOn();
  const miaCode = await invite(mia, 'Den');
  expect((await json(await emailIt(zed, 'Den', miaCode, 'a@example.org'))).status).toBe(403); // someone else's
  expect((await emailIt(owner, 'Den', miaCode, 'a@example.org')).status).toBe(202); // the server's owner may
  const otherCode = await invite(owner, 'Other');
  expect((await emailIt(owner, 'Den', otherCode, 'a@example.org')).status).toBe(404); // not this server's invite
  const once = await invite(owner, 'Den', { maxUses: 1 });
  db.raw.prepare('UPDATE invites SET uses = 1 WHERE code = ?').run(once);
  expect((await emailIt(owner, 'Den', once, 'a@example.org')).status).toBe(410);
  expect(await json(await emailIt(owner, 'Den', miaCode, 'not-an-address'))).toEqual({ status: 400, body: { error: 'Enter an email address' } });
  mailOff();
  expect(await json(await emailIt(owner, 'Den', miaCode, 'a@example.org'))).toEqual({ status: 409, body: { error: 'This server can’t send email right now' } });
  // The sign-in screen knows not to offer it.
  expect((await json(await call(null, 'GET', '/auth-info'))).body.email).toBe(false);
});

test('10 invites by email an hour per sender', async () => {
  mailOn();
  const code = await invite(owner, 'Den');
  serverModule.config.rateLimit = true;
  try {
    for (let i = 0; i < 10; i++) expect((await emailIt(owner, 'Den', code, `p${i}@example.org`)).status).toBe(202);
    expect(await json(await emailIt(owner, 'Den', code, 'p10@example.org'))).toEqual({ status: 429, body: { error: 'That’s 10 invites by email this hour. Try again later, or copy the link instead.' } });
  } finally {
    serverModule.config.rateLimit = false;
    require('../auth/rateLimit')._reset();
  }
});

test('the template escapes names and links', () => {
  const t = templates.serverInvite({ serverName: 'Gourd <b>', publicUrl: 'https://x.example', inviter: 'a"b', space: 'Den & Co', link: 'https://x.example/invite/AB?c=1&d=2', expiresAt: null, newAccounts: true });
  expect(t.html).toContain('Den &amp; Co');
  expect(t.html).toContain('a&quot;b');
  expect(t.html).toContain('href="https://x.example/invite/AB?c=1&amp;d=2"');
  expect(t.html).not.toMatch(/<b>|<img|<script/);
});
