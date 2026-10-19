// P3-25d: category permissions — set on a category, copied onto channels
// created in or moved into it (never synced), and "apply to all".
const os = require('os');
const path = require('path');

let serverModule;
let db;
let port;
const users = {};
const SPACE = 'Gated';

beforeAll((done) => {
  process.env.PORT = 0;
  process.env.JWT_SECRET = 'disgourd-test-secret-0123456789abcdef';
  process.env.DB_PATH = ':memory:';
  process.env.UPLOADS_DIR = path.join(os.tmpdir(), `disgourd-test-uploads-catperms-${process.pid}`);
  serverModule = require('../server');
  db = serverModule.db;
  serverModule.httpServer.listen(0, () => {
    port = serverModule.httpServer.address().port;
    done();
  });
});
afterAll((done) => {
  serverModule.httpServer.close(done);
});

const call = async (who, method, p, body) => {
  const res = await fetch(`http://localhost:${port}${p}`, {
    method, headers: { 'content-type': 'application/json', Authorization: `Bearer ${users[who].token}` }, body: body && JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const S = `/spaces/${SPACE}`;
const mine = async (who) => (await call(who, 'GET', '/spaces')).body.find((s) => s.name === SPACE);
const sees = async (who, channel) => Object.keys((await mine(who)).channelMeta).includes(channel);
const overridesOf = (channel) => db.getChannelOverrides(db.channelRef(SPACE, channel).channelId).map(({ roleId, view, post }) => ({ roleId, view, post }));

let spaceId;
let everyone;
let staff;
let staffCat;
beforeAll(async () => {
  for (const name of ['owner', 'member', 'helper']) {
    const res = await fetch(`http://localhost:${port}/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: name, password: 'password123', email: `${name}@example.com` }),
    });
    users[name] = { token: (await res.json()).token, id: db.getUserByUsername(name).id };
  }
  spaceId = db.createSpaceWithDefaults(SPACE, users.owner.id);
  db.addMember(spaceId, users.member.id, 'member');
  db.addMember(spaceId, users.helper.id, 'member');
  everyone = db.raw.prepare('SELECT id FROM roles WHERE space_id = ? AND is_default = 1').get(spaceId).id;
  staff = db.createRole(spaceId, { name: 'Staff', permissions: [] });
  db.addMemberRole(spaceId, users.helper.id, staff.id);
  staffCat = (await call('owner', 'POST', `${S}/categories`, { name: 'Staff only' })).body;
});

test('category overrides: managers set and read them; members can’t; unknown roles and categories refused', async () => {
  const url = `${S}/categories/${staffCat.id}/overrides`;
  expect((await call('member', 'GET', url)).status).toBe(403);
  expect((await call('member', 'PUT', url, { overrides: [] })).status).toBe(403);
  expect((await call('owner', 'PUT', url, { overrides: [{ roleId: 999999, view: false }] })).body).toEqual({ error: 'Unknown role' });
  expect((await call('owner', 'PUT', url, { overrides: 'no' })).status).toBe(400);
  expect((await call('owner', 'GET', `${S}/categories/99999/overrides`)).status).toBe(404);
  const saved = await call('owner', 'PUT', url, { overrides: [{ roleId: everyone, view: false, post: false }, { roleId: staff.id, view: true, post: true }] });
  expect(saved.body.overrides).toEqual(expect.arrayContaining([{ roleId: everyone, view: 0, post: 0 }, { roleId: staff.id, view: 1, post: 1 }]));
  expect((await call('owner', 'GET', url)).body.overrides).toHaveLength(2);
  expect((await mine('owner')).categories.find((c) => c.id === staffCat.id)).toMatchObject({ hasOverrides: true });
  expect((await mine('owner')).categories.find((c) => c.name === 'Text channels')).toMatchObject({ hasOverrides: false });
});

test('a channel created in the category starts with its access: hidden from members without the role', async () => {
  expect((await call('owner', 'POST', `${S}/channels`, { name: 'mods', category: staffCat.id })).status).toBe(201);
  expect(overridesOf('mods')).toEqual(expect.arrayContaining([{ roleId: everyone, view: 0, post: 0 }, { roleId: staff.id, view: 1, post: 1 }]));
  expect(await sees('member', 'mods')).toBe(false);
  expect(await sees('helper', 'mods')).toBe(true);
  expect(await sees('owner', 'mods')).toBe(true);
  // A channel in a plain category starts open, as before.
  await call('owner', 'POST', `${S}/channels`, { name: 'chat' });
  expect(overridesOf('chat')).toEqual([]);
  expect(await sees('member', 'chat')).toBe(true);
});

test('no syncing: changing the category later doesn’t change channels already in it', async () => {
  await call('owner', 'PUT', `${S}/categories/${staffCat.id}/overrides`, { overrides: [{ roleId: everyone, view: true, post: false }] });
  expect(overridesOf('mods')).toEqual(expect.arrayContaining([{ roleId: everyone, view: 0, post: 0 }]));
  expect(await sees('member', 'mods')).toBe(false);
  // Back to private for the rest.
  await call('owner', 'PUT', `${S}/categories/${staffCat.id}/overrides`, { overrides: [{ roleId: everyone, view: false, post: false }] });
});

test('moving a channel in replaces its access with a copy; to the top or a plain category it keeps its own', async () => {
  const s = await mine('owner');
  const cats = s.categories.map((c) => c.id);
  const text = s.categories.find((c) => c.name === 'Text channels').id;
  const layout = (moves) => ({
    categories: cats,
    channels: Object.keys(s.channelMeta).map((name) => ({ name, category: name in moves ? moves[name] : s.channelMeta[name].category })),
  });
  // "chat" (open) into Staff only: now private.
  const moved = await call('owner', 'PUT', `${S}/layout`, layout({ chat: staffCat.id }));
  expect(moved.status).toBe(200);
  expect(await sees('member', 'chat')).toBe(false);
  expect(overridesOf('chat')).toEqual(expect.arrayContaining([{ roleId: everyone, view: 0, post: 0 }]));
  // Back out to the top: it keeps the private access (moving out changes nothing).
  const s2 = await mine('owner');
  const out = { categories: cats, channels: Object.keys(s2.channelMeta).map((name) => ({ name, category: name === 'chat' ? null : s2.channelMeta[name].category })) };
  expect((await call('owner', 'PUT', `${S}/layout`, out)).status).toBe(200);
  expect(await sees('member', 'chat')).toBe(false);
  // Into a plain category: also kept.
  const s3 = await mine('owner');
  const into = { categories: cats, channels: Object.keys(s3.channelMeta).map((name) => ({ name, category: name === 'chat' ? text : s3.channelMeta[name].category })) };
  expect((await call('owner', 'PUT', `${S}/layout`, into)).status).toBe(200);
  expect(await sees('member', 'chat')).toBe(false);
  // Reordering within its own category isn't a move in: nothing copied.
  db.setChannelOverride(db.channelRef(SPACE, 'mods').channelId, staff.id, { view: 1, post: 0 });
  const s4 = await mine('owner');
  const same = { categories: cats, channels: Object.keys(s4.channelMeta).map((name) => ({ name, category: s4.channelMeta[name].category })).reverse() };
  expect((await call('owner', 'PUT', `${S}/layout`, same)).status).toBe(200);
  expect(overridesOf('mods')).toEqual(expect.arrayContaining([{ roleId: staff.id, view: 1, post: 0 }]));
});

test('apply to all: overwrites every channel in the category the manager can see; members refused', async () => {
  const url = `${S}/categories/${staffCat.id}/apply`;
  expect((await call('member', 'POST', url)).status).toBe(403);
  // Open the category up, then apply: mods becomes visible to members again.
  await call('owner', 'PUT', `${S}/categories/${staffCat.id}/overrides`, { overrides: [{ roleId: everyone, view: true, post: true }] });
  expect(await sees('member', 'mods')).toBe(false);
  const applied = await call('owner', 'POST', url);
  expect(applied.body).toEqual({ changed: 1 });
  expect(await sees('member', 'mods')).toBe(true);
  // A full copy of the category's: Staff's post goes from the channel's own 0 to the category's 1.
  expect(overridesOf('mods').sort((a, b) => a.roleId - b.roleId)).toEqual([{ roleId: everyone, view: 1, post: 1 }, { roleId: staff.id, view: 1, post: 1 }].sort((a, b) => a.roleId - b.roleId));
  expect((await call('owner', 'POST', `${S}/categories/99999/apply`)).status).toBe(404);
});

test('deleting a category removes its overrides; the channels keep what they had', async () => {
  await call('owner', 'PUT', `${S}/categories/${staffCat.id}/overrides`, { overrides: [{ roleId: everyone, view: false }] });
  expect((await call('owner', 'DELETE', `${S}/categories/${staffCat.id}`)).status).toBe(200);
  expect(db.raw.prepare('SELECT COUNT(*) AS n FROM category_role_overrides WHERE category_id = ?').get(staffCat.id).n).toBe(0);
  expect(await sees('member', 'mods')).toBe(true); // still the open access applied above
});
