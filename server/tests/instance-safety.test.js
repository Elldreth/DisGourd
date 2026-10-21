// P11-09: instance safety. Site admins can suspend an account (it's signed out
// everywhere and can't sign in until lifted); by default only friends and
// people who share a server can start a DM with you or add you to a group;
// friend requests are capped per day.
const WebSocket = require('ws');
const os = require('os');
const path = require('path');

let serverModule;
let db;
let port;
const users = {};
const PASSWORD = 'gourd-test-pass-1';

beforeAll(async () => {
  process.env.PORT = 0;
  process.env.JWT_SECRET = 'disgourd-test-secret-0123456789abcdef';
  process.env.DB_PATH = ':memory:';
  process.env.UPLOADS_DIR = path.join(os.tmpdir(), `disgourd-test-uploads-safety-${process.pid}`);
  serverModule = require('../server');
  db = serverModule.db;
  await new Promise((r) => serverModule.httpServer.listen(0, r));
  port = serverModule.httpServer.address().port;
  // admin (site admin), and: mia shares a server with admin; sol is a stranger to everyone.
  for (const n of ['admin', 'mia', 'sol', 'tess', 'uma']) await register(n);
  db.setSiteAdmin(users.admin.id, true);
  const space = db.createSpaceWithDefaults('Safety', users.admin.id);
  db.addMember(space, users.mia.id, 'member');
  db.addMember(space, users.tess.id, 'member');
});
afterAll((done) => {
  serverModule.config.rateLimit = false;
  serverModule.wss.clients.forEach((c) => c.terminate());
  serverModule.httpServer.close(done);
  serverModule.httpServer.closeAllConnections();
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const base = () => `http://localhost:${port}`;
const call = async (who, method, p, body) => {
  const res = await fetch(`${base()}${p}`, {
    method, headers: { 'content-type': 'application/json', ...(who ? { Authorization: `Bearer ${users[who].token}` } : {}) }, body: body && JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
async function register(username) {
  const res = await fetch(`${base()}/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: PASSWORD, email: `${username}@example.com` }),
  });
  users[username] = { token: (await res.json()).token, id: db.getUserByUsername(username).id };
}
const login = (username) => call(null, 'POST', '/login', { username, password: PASSWORD });
function connect(who) {
  const ws = new WebSocket(`ws://localhost:${port}/gateway`);
  const frames = [];
  ws.on('message', (raw) => frames.push(JSON.parse(raw.toString())));
  ws.on('error', () => {});
  const closed = new Promise((r) => ws.on('close', (code) => r(code)));
  const opened = new Promise((r) => ws.on('open', () => {
    ws.send(JSON.stringify({ op: 'auth', token: users[who].token }));
    r();
  }));
  return { ws, frames, closed, opened, send: (f) => ws.send(JSON.stringify(f)), of: (t) => frames.filter((f) => f.type === t) };
}

describe('suspending an account', () => {
  test('only site admins can list or suspend', async () => {
    expect((await call('mia', 'GET', '/admin/users?q=s')).status).toBe(403);
    expect((await call('mia', 'PUT', '/admin/users/sol', { suspended: true })).status).toBe(403);
  });

  test('the people list finds accounts by name, with their state', async () => {
    const { status, body } = await call('admin', 'GET', '/admin/users?q=TES');
    expect(status).toBe(200);
    expect(body.users).toEqual([expect.objectContaining({ username: 'tess', siteAdmin: false, suspended: false, suspendedReason: null, lastSeenAt: expect.any(Number) })]);
  });

  test('suspend: sockets close with signed_out, the token stops working, sign-in is refused; lifting it lets them back', async () => {
    const g = connect('tess');
    await g.opened;
    await wait(100);
    expect((await call('tess', 'GET', '/me')).status).toBe(200);

    const res = await call('admin', 'PUT', '/admin/users/tess', { suspended: true, reason: 'spam' });
    expect(res).toEqual({ status: 200, body: expect.objectContaining({ username: 'tess', suspended: true, suspendedReason: 'spam' }) });
    expect(await g.closed).toBe(4001);
    expect(g.of('signed_out')).toEqual([{ type: 'signed_out', reason: 'suspended' }]);
    expect((await call('tess', 'GET', '/me')).status).toBe(401);
    expect(await login('tess')).toEqual({ status: 403, body: { error: 'This account is suspended' } });
    // A wrong password still just says "Invalid credentials" (nothing about the suspension).
    expect((await call(null, 'POST', '/login', { username: 'tess', password: 'wrong-pass-1234' })).status).toBe(401);

    expect((await call('admin', 'PUT', '/admin/users/tess', { suspended: false })).body).toMatchObject({ suspended: false, suspendedReason: null });
    const back = await login('tess');
    expect(back.status).toBe(200);
    users.tess.token = back.body.token;
    expect((await call('tess', 'GET', '/me')).status).toBe(200);
  });

  test('not yourself, not the last site admin, not someone unknown', async () => {
    expect((await call('admin', 'PUT', '/admin/users/admin', { suspended: true })).status).toBe(400);
    expect((await call('admin', 'PUT', '/admin/users/nobody', { suspended: true })).status).toBe(404);
    // A second site admin can't suspend the only other one if that leaves none.
    db.setSiteAdmin(users.uma.id, true);
    expect((await call('uma', 'PUT', '/admin/users/admin', { suspended: true })).status).toBe(200);
    // Now admin is suspended; uma is the last active site admin and can't be suspended by anyone.
    expect((await call('admin', 'PUT', '/admin/users/admin', { suspended: false })).status).toBe(401); // signed out
    expect((await call('uma', 'PUT', '/admin/users/admin', { suspended: false })).status).toBe(200);
    users.admin.token = (await login('admin')).body.token;
    db.setSiteAdmin(users.uma.id, false);
    expect((await call('admin', 'PUT', '/admin/users/uma', { suspended: 'yes' })).status).toBe(400);
  });
});

describe('who can DM me', () => {
  test('the default is friends and shared servers, shown on /me', async () => {
    expect((await call('mia', 'GET', '/me')).body.dmPolicy).toBe('friends_and_servers');
    expect((await call('mia', 'PATCH', '/me', { dmPolicy: 'strangers' })).status).toBe(400);
  });

  test('a stranger can’t start a DM; someone who shares a server can; an existing conversation keeps working', async () => {
    const sol = connect('sol');
    const admin = connect('admin');
    await Promise.all([sol.opened, admin.opened]);
    await wait(80);
    sol.send({ op: 'dm', to: 'mia', content: 'hello stranger' });
    admin.send({ op: 'dm', to: 'mia', content: 'hi mia' });
    await wait(150);
    expect(sol.of('error').at(-1)).toEqual({ type: 'error', op: 'dm', code: 'NOT_ALLOWED', error: "You can't message this person" });
    expect(db.findPair(users.sol.id, users.mia.id)).toBeFalsy(); // no empty conversation left behind
    expect(db.getDmMessages(users.admin.id, users.mia.id).map((m) => m.content)).toEqual(['hi mia']);
    sol.ws.close();
    admin.ws.close();
  });

  test('with "everyone", the stranger can; switching back keeps that conversation', async () => {
    expect((await call('mia', 'PATCH', '/me', { dmPolicy: 'everyone' })).body.dmPolicy).toBe('everyone');
    const sol = connect('sol');
    await sol.opened;
    await wait(80);
    sol.send({ op: 'dm', to: 'mia', content: 'hello now' });
    await wait(150);
    expect(db.getDmMessages(users.sol.id, users.mia.id).map((m) => m.content)).toEqual(['hello now']);
    await call('mia', 'PATCH', '/me', { dmPolicy: 'friends_and_servers' });
    sol.send({ op: 'dm', to: 'mia', content: 'still here' });
    await wait(150);
    expect(db.getDmMessages(users.sol.id, users.mia.id).map((m) => m.content)).toEqual(['hello now', 'still here']);
    sol.ws.close();
  });

  test('group adds follow the same rule', async () => {
    const sol = connect('sol');
    await sol.opened;
    await wait(80);
    // sol shares nothing with mia or tess: refused, in the same neutral words.
    sol.send({ op: 'dm_group_create', members: ['mia', 'tess'] });
    await wait(150);
    expect(sol.of('error').at(-1)).toMatchObject({ op: 'dm_group_create', code: 'NOT_ALLOWED', error: "You can't add mia" });
    // With "everyone", mia can be added by a stranger; tess still can't.
    await call('mia', 'PATCH', '/me', { dmPolicy: 'everyone' });
    sol.send({ op: 'dm_group_create', members: ['mia', 'tess'] });
    await wait(150);
    expect(sol.of('error').at(-1)).toMatchObject({ error: "You can't add tess" });
    await call('tess', 'PATCH', '/me', { dmPolicy: 'everyone' });
    sol.send({ op: 'dm_group_create', members: ['mia', 'tess'] });
    await wait(150);
    expect(sol.of('dm_group_created')).toHaveLength(1);
    await call('mia', 'PATCH', '/me', { dmPolicy: 'friends_and_servers' });
    await call('tess', 'PATCH', '/me', { dmPolicy: 'friends_and_servers' });
    sol.ws.close();
  });
});

test('friend requests: at most 20 a day from one person', async () => {
  for (let i = 0; i < 20; i++) await register(`fr${i}`);
  serverModule.config.rateLimit = true;
  try {
    for (let i = 0; i < 20; i++) expect((await call('uma', 'POST', '/friends/request', { username: `fr${i}` })).status).toBe(201);
    expect(await call('uma', 'POST', '/friends/request', { username: 'sol' })).toEqual({ status: 429, body: { error: 'You’ve sent a lot of friend requests today. Try again tomorrow.' } });
  } finally {
    serverModule.config.rateLimit = false;
  }
});
