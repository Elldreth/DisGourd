// P9-02: the owner hands a server to another member — confirmation by name,
// refusals, the new owner's powers, the old owner as Admin (with fallbacks),
// the log and the frames.
const WebSocket = require('ws');
const os = require('os');
const path = require('path');

let serverModule;
let port;

beforeAll((done) => {
  process.env.PORT = 0;
  process.env.JWT_SECRET = 'disgourd-test-secret-0123456789abcdef';
  process.env.DB_PATH = ':memory:';
  process.env.UPLOADS_DIR = path.join(os.tmpdir(), `disgourd-test-uploads-transfer-${process.pid}`);
  serverModule = require('../server');
  serverModule.httpServer.listen(0, () => {
    port = serverModule.httpServer.address().port;
    done();
  });
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const users = {}; // name -> { token, id, gw }

afterAll((done) => {
  for (const u of Object.values(users)) u.gw?.close();
  serverModule.httpServer.close(done);
});

async function register(username) {
  const res = await fetch(`http://localhost:${port}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'gourd-test-pass-1', email: `${username}@example.com` }),
  });
  return (await res.json()).token;
}

function gateway(token) {
  const ws = new WebSocket(`ws://localhost:${port}/gateway?token=${token}`);
  const frames = [];
  ws.on('message', (raw) => frames.push(JSON.parse(raw.toString())));
  const ready = new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });
  return { frames, ready, close: () => ws.close() };
}

const call = async (who, method, p, body) => {
  const res = await fetch(`http://localhost:${port}${p}`, {
    method,
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${users[who].token}` },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const transfer = (who, space, user, confirm = space) => call(who, 'POST', `/spaces/${encodeURIComponent(space)}/transfer`, { user, confirm });
const spaceId = (name) => serverModule.db.getSpaceByName(name).id;
const access = (space, name) => serverModule.db.resolveAccess(spaceId(space), users[name].id);
const roleNames = (space, name) => {
  const { db } = serverModule;
  const ids = db.getMemberRoleIds(spaceId(space), users[name].id);
  return db.getRoles(spaceId(space)).filter((r) => ids.includes(r.id)).map((r) => r.name);
};

beforeAll(async () => {
  const { db } = serverModule;
  for (const name of ['sandy', 'bob', 'cara', 'outsider']) {
    const token = await register(name);
    users[name] = { token, id: db.getUserByUsername(name).id };
  }
  for (const s of ['Handover', 'NoAdminRole', 'Bare']) {
    const id = db.createSpaceWithDefaults(s, users.sandy.id);
    db.addMember(id, users.bob.id, 'member');
    db.addMember(id, users.cara.id, 'member');
  }
  for (const name of ['sandy', 'bob', 'cara']) {
    users[name].gw = gateway(users[name].token);
    await users[name].gw.ready;
  }
  await wait(100);
});

test('refusals: only the owner, the right name, a member who is not you', async () => {
  expect((await transfer('bob', 'Handover', 'cara')).status).toBe(403);
  expect((await transfer('sandy', 'Handover', 'bob', 'handover')).status).toBe(400);
  expect((await transfer('sandy', 'Handover', 'bob', '')).status).toBe(400);
  expect((await transfer('sandy', 'Handover', 'outsider')).status).toBe(404);
  expect((await transfer('sandy', 'Handover', 'nobody')).status).toBe(404);
  expect((await transfer('sandy', 'Handover', 'sandy')).status).toBe(400);
  expect(access('Handover', 'sandy').owner).toBe(true);
});

test('a handover moves ownership at once; the old owner becomes an Admin; logged; everyone told', async () => {
  const { db } = serverModule;
  const res = await transfer('sandy', 'Handover', 'bob');
  expect(res).toEqual({ status: 200, body: { owner: 'bob', yourRole: 'Admin' } });
  expect(access('Handover', 'bob').owner).toBe(true);
  const old = access('Handover', 'sandy');
  expect(old.owner).toBe(false);
  expect(roleNames('Handover', 'sandy')).toContain('Admin');
  expect(old.actions.has('manage_roles')).toBe(false); // owner-only by default
  expect(old.actions.has('delete_others_messages')).toBe(true);
  expect(old.position).toBeLessThan(access('Handover', 'bob').position);
  // The legacy tier column follows.
  expect(db.getMemberRole(spaceId('Handover'), users.bob.id)).toBe('owner');
  expect(db.getMemberRole(spaceId('Handover'), users.sandy.id)).toBe('admin');
  await wait(150);
  expect(users.bob.gw.frames).toContainEqual({ type: 'ownership_received', space: 'Handover', from: 'sandy' });
  expect(users.cara.gw.frames.some((f) => f.type === 'members_changed' && f.space === 'Handover')).toBe(true);
  expect(db.getModLog(spaceId('Handover'), { action: 'ownership_transfer' }).entries[0]).toMatchObject({ actor: 'sandy', target: 'bob', details: { role: 'Admin' } });
  // The new owner has the owner's powers: they can hand it back, and sandy can't any more.
  expect((await transfer('sandy', 'Handover', 'cara')).status).toBe(403);
  expect((await transfer('bob', 'Handover', 'sandy')).status).toBe(200);
  expect(access('Handover', 'sandy').owner).toBe(true);
  expect(roleNames('Handover', 'bob')).toContain('Admin');
});

test("if the Admin role was renamed or deleted, the old owner gets the highest role there is", async () => {
  const { db } = serverModule;
  const id = spaceId('NoAdminRole');
  const admin = db.getRoles(id).find((r) => r.name === 'Admin');
  db.deleteRole(id, admin.id);
  db.createRoleAtBottom(id, { name: 'Helpers', color: null, permissions: ['pin_messages'] });
  db.createRoleAtBottom(id, { name: 'Greeters', color: null, permissions: [] });
  const res = await transfer('sandy', 'NoAdminRole', 'cara');
  const top = db.getRoles(id).filter((r) => !r.isDefault).at(-1).name;
  expect(res.body.yourRole).toBe(top);
  expect(roleNames('NoAdminRole', 'sandy')).toEqual([top]);
});

test('with no roles but @everyone, the old owner keeps just @everyone', async () => {
  const { db } = serverModule;
  const id = spaceId('Bare');
  for (const r of db.getRoles(id).filter((x) => !x.isDefault)) db.deleteRole(id, r.id);
  const res = await transfer('sandy', 'Bare', 'bob');
  expect(res.body).toEqual({ owner: 'bob', yourRole: null });
  expect(access('Bare', 'bob').owner).toBe(true);
  expect(access('Bare', 'sandy').owner).toBe(false);
});
