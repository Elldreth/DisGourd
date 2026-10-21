// P12-01: sending email. Settings from the environment, a queue with retries,
// a daily cap and a per-recipient limit, Site admin › Email's status and test
// send, and a password that never shows anywhere.
const os = require('os');
const path = require('path');

const PASS = 'sekrit-smtp-pass-0042';
const MAIL_ENV = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_PASS_FILE', 'MAIL_FROM', 'MAIL_REPLY_TO', 'PUBLIC_URL', 'MAIL_DAILY_LIMIT', 'MAIL_RETRY_MS', 'MAIL_SERVER_NAME'];

let serverModule;
let port;
let admin;
let member;
let mail;
let templates;

// A stand-in for the SMTP connection: records each message; `failNext` makes
// the next sends throw (with the password in the error, as a careless server might).
const outbox = [];
let failNext = 0;
const fakeTransport = {
  sendMail: async (msg) => {
    if (failNext > 0) {
      failNext -= 1;
      throw Object.assign(new Error(`535 Authentication failed for resend:${PASS}`), { response: `535 5.7.8 bad credentials ${PASS}` });
    }
    outbox.push(msg);
    return { messageId: msg.messageId };
  },
};

function setMailEnv(over = {}) {
  for (const k of MAIL_ENV) delete process.env[k];
  Object.assign(process.env, {
    SMTP_HOST: 'smtp.resend.com',
    SMTP_PORT: '587',
    SMTP_USER: 'resend',
    SMTP_PASS: PASS,
    MAIL_FROM: 'DisGourd <no-reply@example.com>',
    PUBLIC_URL: 'https://disgourd.example.com/',
    MAIL_RETRY_MS: '10,10',
    ...over,
  });
}
const until = async (fn, ms = 2000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 10));
  }
};

beforeAll(async () => {
  process.env.PORT = 0;
  process.env.JWT_SECRET = 'disgourd-test-secret-0123456789abcdef';
  process.env.DB_PATH = ':memory:';
  process.env.UPLOADS_DIR = path.join(os.tmpdir(), `disgourd-test-uploads-mail-${process.pid}`);
  for (const k of MAIL_ENV) delete process.env[k];
  serverModule = require('../server');
  mail = require('../mail');
  templates = require('../mail/templates');
  await new Promise((r) => serverModule.httpServer.listen(0, r));
  port = serverModule.httpServer.address().port;
  const reg = async (username) => (await (await fetch(`http://localhost:${port}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'gourd-test-pass-1', email: `${username}@example.com` }),
  })).json()).token;
  admin = await reg('owner'); // the first account is the site admin
  member = await reg('mia');
});
afterAll((done) => {
  for (const k of MAIL_ENV) delete process.env[k];
  mail._setTransport(null);
  serverModule.httpServer.close(done);
});
beforeEach(() => {
  mail._reset();
  mail._setTransport(fakeTransport);
  outbox.length = 0;
  failNext = 0;
});

const call = (token, method, p, body) => fetch(`http://localhost:${port}${p}`, {
  method,
  headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

test('with nothing set, email is off, the page names what is missing, and nothing is sent', async () => {
  for (const k of MAIL_ENV) delete process.env[k];
  expect(mail.enabled()).toBe(false);
  const s = await (await call(admin, 'GET', '/admin/email')).json();
  expect(s).toMatchObject({ enabled: false, missing: ['SMTP_HOST', 'MAIL_FROM', 'PUBLIC_URL'], yourAddress: 'owner@example.com' });
  const res = await call(admin, 'POST', '/admin/email/test', {});
  expect(res.status).toBe(409);
  expect((await res.json()).error).toBe('Email is off. Set SMTP_HOST, MAIL_FROM, PUBLIC_URL on the server first.');
  expect(mail.send({ to: 'a@example.com', subject: 's', text: 't', html: 'h' })).toEqual({ queued: false, reason: 'off' });
  expect(outbox).toHaveLength(0);
  // A user without a password is also "missing".
  setMailEnv({ SMTP_PASS: '' });
  expect(mail.settings().missing).toEqual(['SMTP_PASS or SMTP_PASS_FILE']);
});

test('site admins only', async () => {
  setMailEnv();
  expect((await call(null, 'GET', '/admin/email')).status).toBe(401);
  expect((await call(member, 'GET', '/admin/email')).status).toBe(403);
  expect((await call(member, 'POST', '/admin/email/test', {})).status).toBe(403);
});

test('Send test email: one message with text and HTML, the right From, Reply-To and headers, and a link to PUBLIC_URL', async () => {
  setMailEnv({ MAIL_REPLY_TO: 'admin@example.com', MAIL_SERVER_NAME: 'Gourd Club' });
  const status = await (await call(admin, 'GET', '/admin/email')).json();
  expect(status).toMatchObject({ enabled: true, missing: [], from: 'DisGourd <no-reply@example.com>', server: 'smtp.resend.com:587', tls: 'starttls', publicUrl: 'https://disgourd.example.com' });
  const res = await call(admin, 'POST', '/admin/email/test', {});
  expect(res.status).toBe(202);
  expect(await res.json()).toEqual({ queued: true, to: 'owner@example.com' }); // your own address by default
  await until(() => outbox.length === 1 && mail.idle());
  const m = outbox[0];
  expect(m).toMatchObject({ from: 'DisGourd <no-reply@example.com>', replyTo: 'admin@example.com', to: 'owner@example.com', subject: 'Test email from Gourd Club', headers: { 'Auto-Submitted': 'auto-generated' } });
  expect(m.messageId).toMatch(/^<[0-9a-f-]{36}@example\.com>$/);
  expect(m.text).toContain('sent by owner from Settings › Site admin › Email');
  expect(m.text).toContain('Open Gourd Club: https://disgourd.example.com');
  expect(m.html).toContain('href="https://disgourd.example.com"');
  // Another address can be typed in.
  expect(await (await call(admin, 'POST', '/admin/email/test', { to: ' friend@example.org ' })).json()).toEqual({ queued: true, to: 'friend@example.org' });
  await until(() => outbox.length === 2);
  expect((await call(admin, 'POST', '/admin/email/test', { to: 'not an address' })).status).toBe(400);
  const after = await (await call(admin, 'GET', '/admin/email')).json();
  expect(after.today).toMatchObject({ sent: 2, failed: 0, pending: 0 });
});

test('a failed send is retried up to 3 times, the request answers at once, and the password never shows', async () => {
  setMailEnv();
  const logs = [];
  const spies = ['log', 'warn', 'error'].map((k) => jest.spyOn(console, k).mockImplementation((...a) => logs.push(a.join(' '))));
  try {
    // Two failures, then it goes through.
    failNext = 2;
    const started = Date.now();
    const res = await call(admin, 'POST', '/admin/email/test', {});
    expect(res.status).toBe(202);
    expect(Date.now() - started).toBeLessThan(1000);
    await until(() => outbox.length === 1 && mail.idle());
    expect(mail.status().today).toMatchObject({ sent: 1, failed: 0 });
    // Three failures: given up, counted, the last error kept (without the password).
    failNext = 3;
    mail.send({ to: 'x@example.net', subject: 'Hello', text: 't', html: 'h' });
    await until(() => mail.status().today.failed === 1 && mail.idle());
    const s = await (await call(admin, 'GET', '/admin/email')).json();
    expect(s.lastError.message).toContain('[redacted]');
    for (const text of [JSON.stringify(s), ...logs]) expect(text).not.toContain(PASS);
    // Log lines name the recipient's domain only.
    expect(logs.join('\n')).toContain('…@example.net');
    expect(logs.join('\n')).not.toContain('x@example.net');
  } finally {
    spies.forEach((s) => s.mockRestore());
  }
});

test('the daily cap and the per-recipient limit hold, and the page shows the counts', async () => {
  setMailEnv({ MAIL_DAILY_LIMIT: '7' });
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const log = jest.spyOn(console, 'log').mockImplementation(() => {});
  try {
    const one = (to) => mail.send({ to, subject: 's', text: 't', html: 'h' });
    for (let i = 0; i < 5; i++) expect(one('same@example.com')).toEqual({ queued: true });
    expect(one('SAME@example.com')).toEqual({ queued: false, reason: 'recipient' }); // 6th this hour, any case
    expect(one('b@example.com')).toEqual({ queued: true });
    expect(one('c@example.com')).toEqual({ queued: true }); // 7 queued today: the cap
    expect(one('d@example.com')).toEqual({ queued: false, reason: 'cap' });
    await until(() => mail.idle());
    expect(mail.status().today).toMatchObject({ sent: 7, overCap: 1, overRecipient: 1 });
    const res = await call(admin, 'POST', '/admin/email/test', { to: 'e@example.com' });
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe('Today’s limit of 7 emails is reached.');
  } finally {
    warn.mockRestore();
    log.mockRestore();
  }
});

test('port 587 requires STARTTLS, 465 is TLS from the start, and the password comes from SMTP_PASS_FILE too', () => {
  const fs = require('fs');
  setMailEnv({ SMTP_PASS: '', SMTP_PASS_FILE: path.join(os.tmpdir(), `smtp-pass-${process.pid}`) });
  fs.writeFileSync(process.env.SMTP_PASS_FILE, `${PASS}\n`);
  try {
    mail._setTransport(null);
    const t587 = mail._getTransport(mail.settings()).options;
    expect(t587).toMatchObject({ host: 'smtp.resend.com', port: 587, secure: false, requireTLS: true, auth: { user: 'resend', pass: PASS } });
    process.env.SMTP_PORT = '465';
    const t465 = mail._getTransport(mail.settings()).options;
    expect(t465).toMatchObject({ port: 465, secure: true, requireTLS: false });
  } finally {
    fs.rmSync(process.env.SMTP_PASS_FILE, { force: true });
  }
});

test('templates escape what they are given', () => {
  const t = templates.testEmail({ serverName: '<b>Club</b>', publicUrl: 'https://x.example/?a=1&b=2', by: 'o"wner' });
  expect(t.subject).toBe('Test email from <b>Club</b>'); // a subject is plain text
  expect(t.html).toContain('&lt;b&gt;Club&lt;/b&gt;');
  expect(t.html).toContain('href="https://x.example/?a=1&amp;b=2"');
  expect(t.html).toContain('o&quot;wner');
  expect(t.html).not.toMatch(/<img|<script/);
  expect(t.text).toContain('Open <b>Club</b>: https://x.example/?a=1&b=2');
});
