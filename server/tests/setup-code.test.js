// P11-01: an empty instance needs its one-time setup code for the first
// account, whatever the registration mode; SITE_ADMINS promotes only accounts
// that existed when a name was first listed, once.
const fs = require('fs');
const os = require('os');
const path = require('path');

const CODE_FILE = path.join(os.tmpdir(), `disgourd-test-setup-code-${process.pid}`);
let serverModule;
let config;
let port;

beforeAll((done) => {
  fs.rmSync(CODE_FILE, { force: true });
  process.env.PORT = 0;
  process.env.JWT_SECRET = 'disgourd-test-secret-0123456789abcdef';
  process.env.DB_PATH = ':memory:';
  process.env.UPLOADS_DIR = path.join(os.tmpdir(), `disgourd-test-uploads-setup-${process.pid}`);
  process.env.REQUIRE_SETUP_CODE = '1';
  process.env.SETUP_CODE_FILE = CODE_FILE;
  process.env.REGISTRATION_MODE = 'closed';
  process.env.SITE_ADMINS = 'ghost';
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  serverModule = require('../server');
  config = require('../config');
  serverModule.httpServer.listen(0, () => {
    port = serverModule.httpServer.address().port;
    done();
  });
});
afterAll((done) => {
  console.warn.mockRestore();
  fs.rmSync(CODE_FILE, { force: true });
  delete process.env.REQUIRE_SETUP_CODE;
  delete process.env.SETUP_CODE_FILE;
  delete process.env.SITE_ADMINS;
  delete process.env.REGISTRATION_MODE;
  serverModule.httpServer.close(done);
});

const base = () => `http://localhost:${port}`;
const register = (username, extra = {}, token) =>
  fetch(`${base()}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ username, password: 'password123', email: `${username}@example.com`, ...extra }),
  });
const call = async (token, method, p, body) => {
  const res = await fetch(`${base()}${p}`, { method, headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` }, body: body && JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
};

let ownerToken;

test('an empty instance writes a setup code (0600) and says it is needed', async () => {
  const code = fs.readFileSync(CODE_FILE, 'utf8').trim();
  expect(code).toMatch(/^[\w-]{12,}$/);
  if (process.platform !== 'win32') expect(fs.statSync(CODE_FILE).mode & 0o777).toBe(0o600);
  const info = await (await fetch(`${base()}/auth-info`)).json();
  expect(info).toEqual({ registration: 'closed', setup: true, setupCode: true });
});

test('the first account needs the code: none or wrong → 403, right → 201 and site admin', async () => {
  const none = await register('mallory');
  expect(none.status).toBe(403);
  expect((await none.json()).error).toMatch(/setup code/);
  expect((await register('mallory', { setupCode: 'not-the-code' })).status).toBe(403);
  expect(serverModule.db.countUsers()).toBe(0);
  const code = fs.readFileSync(CODE_FILE, 'utf8').trim();
  const res = await register('owner', { setupCode: code });
  expect(res.status).toBe(201);
  ownerToken = (await res.json()).token;
  expect((await call(ownerToken, 'GET', '/me')).body.siteAdmin).toBe(true);
});

test('after the first account: the file is gone, registration is closed, and a restart makes no new code', async () => {
  expect(fs.existsSync(CODE_FILE)).toBe(false);
  expect((await register('second')).status).toBe(403); // closed
  const code = 'whatever';
  expect((await register('third', { setupCode: code })).status).toBe(403);
  expect(config.ensureSetupCode()).toBeNull(); // what boot does
  expect(fs.existsSync(CODE_FILE)).toBe(false);
  expect(await (await fetch(`${base()}/auth-info`)).json()).toEqual({ registration: 'closed', setup: false });
});

test('SITE_ADMINS: a name registered after it was listed is not promoted on restart', async () => {
  const { db } = serverModule;
  // "ghost" was listed at boot, before any account existed.
  expect((await call(ownerToken, 'PUT', '/admin/registration', { mode: 'open' })).status).toBe(200);
  expect((await register('ghost')).status).toBe(201);
  config.applySiteAdmins(['ghost']); // a restart
  expect(db.isSiteAdmin(db.getUserByUsername('ghost').id)).toBe(false);
  expect(console.warn.mock.calls.some(([m]) => /ghost/.test(m) && /Settings/.test(m))).toBe(true);
});

test('SITE_ADMINS: an existing account is promoted once; demoting it in the app sticks across restarts', async () => {
  const { db } = serverModule;
  expect((await register('ivy')).status).toBe(201);
  config.applySiteAdmins(['ivy']); // first boot that lists her
  const ivy = db.getUserByUsername('ivy').id;
  expect(db.isSiteAdmin(ivy)).toBe(true);
  expect((await call(ownerToken, 'PUT', '/admin/registration/admins/ivy', { admin: false })).status).toBe(200);
  config.applySiteAdmins(['ivy']); // restart
  expect(db.isSiteAdmin(ivy)).toBe(false);
});
