// P11-13: the low-severity sweep. L1 fixed error texts on sign-in and sign-up;
// L3 moderators see nothing from channels they can't view; L4 tokens without
// a session are refused and open sockets are re-checked; L6 one sign-up
// message; L7 invites expire after 7 days unless asked otherwise.
const WebSocket = require('ws');
const os = require('os');
const path = require('path');

let serverModule;
let db;
let port;
const users = {};
const SPACE = 'Sweep';
const PASSWORD = 'amber-lantern-orbit-58';

beforeAll(async () => {
  process.env.PORT = 0;
  process.env.JWT_SECRET = 'disgourd-test-secret-0123456789abcdef';
  process.env.DB_PATH = ':memory:';
  process.env.UPLOADS_DIR = path.join(os.tmpdir(), `disgourd-test-uploads-sweep-${process.pid}`);
  serverModule = require('../server');
  db = serverModule.db;
  await new Promise((r) => serverModule.httpServer.listen(0, r));
  port = serverModule.httpServer.address().port;
  for (const n of ['owner', 'admin', 'bob']) await register(n);
  const id = db.createSpaceWithDefaults(SPACE, users.owner.id);
  db.addMember(id, users.admin.id, 'admin');
  db.addMember(id, users.bob.id, 'member');
  db.createChannel(SPACE, 'staff');
  db.setChannelPerms(SPACE, 'staff', 3, 3); // owner only: admin is a moderator who can't see it
});
afterAll((done) => {
  serverModule.wss.clients.forEach((c) => c.terminate());
  serverModule.httpServer.close(done);
  serverModule.httpServer.closeAllConnections();
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const base = () => `http://localhost:${port}`;
async function rawPost(p, body, headers = {}) {
  const res = await fetch(`${base()}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const call = async (who, method, p, body) => {
  const res = await fetch(`${base()}${p}`, {
    method, headers: { 'content-type': 'application/json', Authorization: `Bearer ${users[who].token}` }, body: body && JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
async function register(username) {
  const res = await rawPost('/register', JSON.stringify({ username, password: PASSWORD, email: `${username}@example.com` }));
  users[username] = { token: res.body.token, id: db.getUserByUsername(username).id };
}
const S = `/spaces/${SPACE}`;

describe('L1: fixed error texts', () => {
  test('an unexpected failure in /register or /login answers 500 without its message, and logs it', async () => {
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    const boom = jest.spyOn(db, 'createUserRedeemingCode').mockImplementation(() => {
      throw new Error('SQLITE_IOERR at /config/disgourd.db');
    });
    try {
      const res = await rawPost('/register', JSON.stringify({ username: 'erin', password: PASSWORD, email: 'erin@example.com' }));
      expect(res).toEqual({ status: 500, body: { error: 'Something went wrong. Please try again.' } });
      expect(err.mock.calls.some(([, e]) => /SQLITE_IOERR/.test(e && e.message))).toBe(true); // logged, not sent
    } finally {
      boom.mockRestore();
      err.mockRestore();
    }
  });

  test('a body that isn’t JSON is a 400 with our own words, not the parser’s', async () => {
    const res = await rawPost('/login', '{"username": ');
    expect(res).toEqual({ status: 400, body: { error: 'Invalid JSON' } }); // ours; no parser position or token
  });
});

describe('L3: moderators and channels they can’t see', () => {
  test('reports from #staff are hidden from a moderator who can’t view it, counts included', async () => {
    const sid = db.getSpaceByName(SPACE).id;
    const general = db.storeMessage(SPACE, 'general', 'rude in general', users.bob.id).id;
    const staff = db.storeMessage(SPACE, 'staff', 'rude in staff', users.owner.id).id;
    db.createReport(sid, { messageId: general, channel: 'general', authorId: users.bob.id, reporterId: users.owner.id, reason: 'spam', note: null, excerpt: 'rude in general' });
    const hidden = db.createReport(sid, { messageId: staff, channel: 'staff', authorId: users.owner.id, reporterId: users.bob.id, reason: 'spam', note: null, excerpt: 'rude in staff' });
    const forAdmin = await call('admin', 'GET', `${S}/reports`);
    expect(forAdmin.body.reports.map((r) => r.channel)).toEqual(['general']);
    expect((await call('owner', 'GET', `${S}/reports`)).body.reports.map((r) => r.channel).sort()).toEqual(['general', 'staff']);
    expect((await call('admin', 'GET', '/spaces')).body.find((s) => s.name === SPACE).openReports).toBe(1);
    expect((await call('owner', 'GET', '/spaces')).body.find((s) => s.name === SPACE).openReports).toBe(2);
    // Resolving one it can't see is a 404, as if it weren't there.
    expect((await call('admin', 'POST', `${S}/reports/${hidden.id}/resolve`, { action: 'dismiss' })).status).toBe(404);
  });

  test('the moderation log leaves out entries about #staff', async () => {
    const sid = db.getSpaceByName(SPACE).id;
    db.logModAction(sid, { actorId: users.owner.id, targetId: users.bob.id, action: 'message_delete', details: { channel: 'staff', excerpt: 'secret plans' } });
    db.logModAction(sid, { actorId: users.owner.id, targetId: users.bob.id, action: 'message_delete', details: { channel: 'general', excerpt: 'public' } });
    db.logModAction(sid, { actorId: users.owner.id, targetId: users.bob.id, action: 'ban', reason: 'no channel' });
    const adminLog = (await call('admin', 'GET', `${S}/mod-log`)).body.entries;
    expect(JSON.stringify(adminLog)).not.toContain('secret plans');
    expect(adminLog.map((e) => e.details && e.details.channel)).toEqual(expect.arrayContaining(['general', null]));
    expect(JSON.stringify((await call('owner', 'GET', `${S}/mod-log`)).body.entries)).toContain('secret plans');
  });

  test('deleting #staff needs to be able to see it', async () => {
    db.createChannel(SPACE, 'vault');
    db.setChannelPerms(SPACE, 'vault', 3, 3);
    expect((await call('admin', 'DELETE', `${S}/channels/vault`)).status).toBe(404);
    expect((await call('owner', 'DELETE', `${S}/channels/vault`)).status).toBe(200);
  });
});

describe('L4: tokens', () => {
  test('a token without a session (from before P9-03) is refused', async () => {
    const { createToken } = require('../auth/tokens');
    const old = createToken(users.bob.id, 'bob');
    const res = await fetch(`${base()}/me`, { headers: { Authorization: `Bearer ${old}` } });
    expect(res.status).toBe(401);
  });

  test('an open socket whose token has stopped working is closed at the next check', async () => {
    const { reverifySockets } = require('../gateway');
    const login = await rawPost('/login', JSON.stringify({ username: 'bob', password: PASSWORD }));
    const ws = new WebSocket(`ws://localhost:${port}/gateway`);
    const closed = new Promise((r) => ws.on('close', (code) => r(code)));
    await new Promise((r) => ws.on('open', r));
    ws.send(JSON.stringify({ op: 'auth', token: login.body.token }));
    await wait(100);
    reverifySockets(serverModule.wss); // still good: nothing happens
    await wait(50);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    // Eight days later the token has expired.
    const realNow = Date.now;
    Date.now = () => realNow() + 8 * 24 * 3600 * 1000;
    try {
      reverifySockets(serverModule.wss);
    } finally {
      Date.now = realNow;
    }
    expect(await closed).toBe(4001);
  });
});

describe('L6: one sign-up message', () => {
  test('a taken username and a taken email get the same answer', async () => {
    // P13-04: only a confirmed address counts as taken, so bob's is confirmed.
    db.raw.prepare('UPDATE users SET email_verified_at = ? WHERE username = ?').run(Date.now(), 'bob');
    const name = await rawPost('/register', JSON.stringify({ username: 'bob', password: PASSWORD, email: 'new-bob@example.com' }));
    const email = await rawPost('/register', JSON.stringify({ username: 'robert', password: PASSWORD, email: 'bob@example.com' }));
    expect(name).toEqual({ status: 409, body: { error: 'That username or email can’t be used' } });
    expect(email).toEqual(name);
  });
});

describe('L7: invites expire', () => {
  const DAY = 24 * 3600 * 1000;
  test('a new invite lasts 7 days by default', async () => {
    const before = Date.now();
    const res = await call('owner', 'POST', `${S}/invites`);
    expect(res.status).toBe(201);
    expect(res.body.expiresAt).toBeGreaterThanOrEqual(before + 7 * DAY - 1000);
    expect(res.body.expiresAt).toBeLessThanOrEqual(Date.now() + 7 * DAY);
    expect(db.getInvite(res.body.code).expires_at).toBe(res.body.expiresAt);
  });

  test('1 or 30 days, "never", and a use limit can be asked for; anything else is refused', async () => {
    expect((await call('owner', 'POST', `${S}/invites`, { expiresInDays: 1 })).body.expiresAt).toBeLessThanOrEqual(Date.now() + DAY);
    expect((await call('owner', 'POST', `${S}/invites`, { expiresInDays: 30 })).body.expiresAt).toBeGreaterThan(Date.now() + 29 * DAY);
    const never = await call('owner', 'POST', `${S}/invites`, { expiresInDays: null, maxUses: 5 });
    expect(never.body).toMatchObject({ expiresAt: null, maxUses: 5 });
    expect(db.getInvite(never.body.code)).toMatchObject({ expires_at: null, max_uses: 5 });
    expect((await call('owner', 'POST', `${S}/invites`, { expiresInDays: 3 })).status).toBe(400);
    expect((await call('owner', 'POST', `${S}/invites`, { maxUses: 0 })).status).toBe(400);
  });

  test('an expired invite can’t be used', async () => {
    const res = await call('owner', 'POST', `${S}/invites`, { expiresInDays: 1 });
    db.raw.prepare('UPDATE invites SET expires_at = ? WHERE code = ?').run(Date.now() - 1000, res.body.code);
    await register('late');
    expect((await call('late', 'POST', `/invites/${res.body.code}`)).status).toBe(410);
  });
});
