// P2-15: a custom status (emoji + up to 80 characters, optional expiry) that
// co-members see next to your name while you appear online.
const WebSocket = require('ws');
const os = require('os');
const path = require('path');

let serverModule;
let port;
const users = {}; // name -> { token, id, gw, frames }

beforeAll((done) => {
  process.env.PORT = 0;
  process.env.JWT_SECRET = 'disgourd-test-secret-0123456789abcdef';
  process.env.DB_PATH = ':memory:';
  process.env.UPLOADS_DIR = path.join(os.tmpdir(), `disgourd-test-uploads-status-${process.pid}`);
  serverModule = require('../server');
  serverModule.httpServer.listen(0, () => {
    port = serverModule.httpServer.address().port;
    done();
  });
});

afterAll((done) => {
  for (const u of Object.values(users)) u.gw?.close();
  serverModule.httpServer.close(done);
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
const patchMe = (name, body) =>
  fetch(`${base()}/me`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${users[name].token}` },
    body: JSON.stringify(body),
  });
const getMe = async (name) => (await fetch(`${base()}/me`, { headers: { Authorization: `Bearer ${users[name].token}` } })).json();
async function memberAs(viewer, who) {
  const res = await fetch(`${base()}/spaces/Here/members`, { headers: { Authorization: `Bearer ${users[viewer].token}` } });
  return (await res.json()).members.find((m) => m.username === who);
}
const lastPresence = (watcher, who) => users[watcher].frames.filter((f) => f.type === 'presence' && f.user === who).at(-1);

beforeAll(async () => {
  const { db } = serverModule;
  for (const name of ['ria', 'sol']) {
    const token = await register(name);
    users[name] = { token, id: db.getUserByUsername(name).id, frames: [] };
  }
  db.addMember(db.createSpaceWithDefaults('Here', users.ria.id), users.sol.id, 'member');
  for (const u of Object.values(users)) {
    u.gw = new WebSocket(`ws://localhost:${port}/gateway?token=${u.token}`);
    u.gw.on('message', (raw) => u.frames.push(JSON.parse(raw.toString())));
    await new Promise((r) => u.gw.on('open', r));
  }
  await wait(80);
});

test('set a status: you see it, co-members get it live and in the members list', async () => {
  const res = await patchMe('ria', { statusText: '  In a meeting  ', statusEmoji: '📅' });
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ statusText: 'In a meeting', statusEmoji: '📅', statusExpiresAt: null });
  await wait(60);
  expect(lastPresence('sol', 'ria')).toMatchObject({ status: 'online', statusText: 'In a meeting', statusEmoji: '📅' });
  expect(await memberAs('sol', 'ria')).toMatchObject({ statusText: 'In a meeting', statusEmoji: '📅' });
  expect(users.ria.frames.filter((f) => f.type === 'my_status').at(-1)).toMatchObject({ statusText: 'In a meeting', statusEmoji: '📅' });
});

test('markdown and HTML are kept literally (the client shows them as text)', async () => {
  await patchMe('ria', { statusText: '**bold** <img src=x onerror=alert(1)>', statusEmoji: null });
  expect((await memberAs('sol', 'ria')).statusText).toBe('**bold** <img src=x onerror=alert(1)>');
});

test('limits: 80 characters, one real emoji, known expiry choices', async () => {
  expect((await patchMe('ria', { statusText: 'x'.repeat(81) })).status).toBe(400);
  expect((await patchMe('ria', { statusText: 'x'.repeat(80) })).status).toBe(200);
  expect((await patchMe('ria', { statusText: 'hi', statusEmoji: 'not an emoji' })).status).toBe(400);
  expect((await patchMe('ria', { statusText: 'hi', statusEmoji: '😀😀' })).status).toBe(400);
  expect((await patchMe('ria', { statusText: 'hi', statusExpiresIn: '2d' })).status).toBe(400);
  expect((await patchMe('ria', { statusText: 42 })).status).toBe(400);
});

test('clear after 30 minutes / 1 hour / 4 hours / today', async () => {
  const now = Date.now();
  const at = async (statusExpiresIn, extra = {}) => (await (await patchMe('ria', { statusText: 'busy', statusExpiresIn, ...extra })).json()).statusExpiresAt;
  expect(Math.abs((await at('30m')) - (now + 30 * 60e3))).toBeLessThan(5000);
  expect(Math.abs((await at('1h')) - (now + 60 * 60e3))).toBeLessThan(5000);
  expect(Math.abs((await at('4h')) - (now + 4 * 60 * 60e3))).toBeLessThan(5000);
  // "Today" means the end of the day where you are (tzOffset as from Date#getTimezoneOffset).
  const today = await at('today', { tzOffset: 300 }); // UTC-5
  const local = new Date(today - 300 * 60e3); // that moment, as UTC-5 wall-clock
  expect([local.getUTCHours(), local.getUTCMinutes()]).toEqual([0, 0]);
  expect(today).toBeGreaterThan(now);
  expect(today - now).toBeLessThanOrEqual(24 * 60 * 60e3);
  expect(await at(null)).toBeNull();
});

test('an expired status disappears: on read, and the sweep tells everyone', async () => {
  const { db } = serverModule;
  await patchMe('ria', { statusText: 'back soon', statusEmoji: '⏳', statusExpiresIn: '30m' });
  // Pretend it's an hour later.
  db.raw.prepare('UPDATE users SET status_expires_at = ? WHERE id = ?').run(Date.now() - 1000, users.ria.id);
  expect((await memberAs('sol', 'ria')).statusText).toBeNull(); // cleared on read
  expect((await getMe('ria')).statusText).toBeNull();

  await patchMe('ria', { statusText: 'back soon', statusExpiresIn: '30m' });
  db.raw.prepare('UPDATE users SET status_expires_at = ? WHERE id = ?').run(Date.now() - 1000, users.ria.id);
  const { sweepExpiredStatuses } = require('../gateway');
  expect(sweepExpiredStatuses()).toEqual([users.ria.id]);
  await wait(60);
  expect(lastPresence('sol', 'ria')).toMatchObject({ statusText: null, statusEmoji: null });
  expect(users.ria.frames.filter((f) => f.type === 'my_status').at(-1)).toMatchObject({ statusText: null });
  expect(sweepExpiredStatuses()).toEqual([]); // nothing left
});

test('hidden while you look offline (invisible), back when you are visible', async () => {
  await patchMe('ria', { statusText: 'secret plans', statusEmoji: null, statusExpiresIn: null });
  await patchMe('ria', { presence: 'invisible' });
  await wait(60);
  expect(lastPresence('sol', 'ria')).toMatchObject({ status: 'offline', statusText: null });
  expect((await memberAs('sol', 'ria')).statusText).toBeNull();
  expect((await getMe('ria')).statusText).toBe('secret plans'); // you still see your own
  await patchMe('ria', { presence: 'online' });
  await wait(60);
  expect(lastPresence('sol', 'ria')).toMatchObject({ status: 'online', statusText: 'secret plans' });
});

test('an empty text clears the status', async () => {
  await patchMe('ria', { statusText: '', statusEmoji: null });
  expect((await getMe('ria')).statusText).toBeNull();
  expect((await memberAs('sol', 'ria')).statusText).toBeNull();
});
