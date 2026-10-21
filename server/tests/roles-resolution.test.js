// P2-21b: the live checks read the roles tables. A custom role grants what it
// says, everywhere: actions over the gateway, access to a private channel in
// history, live frames, counts, search and the server list, and kicking by
// position.
const WebSocket = require('ws');
const os = require('os');
const path = require('path');

let serverModule;
let db;
let port;
const users = {}; // name -> { token, id, gw, frames }
const SPACE = 'Roleplay';

beforeAll((done) => {
  process.env.PORT = 0;
  process.env.JWT_SECRET = 'disgourd-test-secret-0123456789abcdef';
  process.env.DB_PATH = ':memory:';
  process.env.UPLOADS_DIR = path.join(os.tmpdir(), `disgourd-test-uploads-roles2-${process.pid}`);
  serverModule = require('../server');
  db = serverModule.db;
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
const auth = (who) => ({ Authorization: `Bearer ${users[who].token}` });
const get = (who, p) => fetch(`${base()}${p}`, { headers: auth(who) });
const req = (who, method, p, body) =>
  fetch(`${base()}${p}`, { method, headers: { 'content-type': 'application/json', ...auth(who) }, body: body && JSON.stringify(body) });
const send = (who, frame) => users[who].gw.send(JSON.stringify(frame));
const framesOf = (who, type) => users[who].frames.filter((f) => f.type === type);
const reconnectFrame = async (who) => {
  users[who].gw.close();
  users[who].frames = [];
  await connect(who);
  await wait(80);
  return framesOf(who, 'unread')[0];
};

async function register(username) {
  const res = await fetch(`${base()}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'gourd-test-pass-1', email: `${username}@example.com` }),
  });
  return (await res.json()).token;
}
function connect(who) {
  const u = users[who];
  u.gw = new WebSocket(`ws://localhost:${port}/gateway?token=${u.token}`);
  u.gw.on('message', (raw) => u.frames.push(JSON.parse(raw.toString())));
  return new Promise((r) => u.gw.on('open', r));
}

let spaceId;
let mods; // the custom role
beforeAll(async () => {
  for (const name of ['owner', 'mod', 'pleb', 'helper']) {
    const token = await register(name);
    users[name] = { token, id: db.getUserByUsername(name).id, frames: [] };
  }
  spaceId = db.createSpaceWithDefaults(SPACE, users.owner.id);
  for (const n of ['mod', 'pleb', 'helper']) db.addMember(spaceId, users[n].id, 'member');
  db.createChannel(SPACE, 'staff');
  db.setChannelPerms(SPACE, 'staff', 2, 2); // admins only, by the tiers
  mods = db.createRole(spaceId, { name: 'Mods', color: '#ff8800', permissions: ['pin_messages', 'kick'] });
  db.addMemberRole(spaceId, users.mod.id, mods.id);
  for (const n of Object.keys(users)) await connect(n);
  await wait(80);
});

test('GET /spaces tells the client what it may do: abilities, owner, position and canPost', async () => {
  const mine = (await (await get('mod', '/spaces')).json()).find((s) => s.name === SPACE);
  expect(mine).toMatchObject({ owner: false, position: 2, role: 'member' });
  expect(mine.abilities.sort()).toEqual(['invite', 'kick', 'pin_messages']); // @everyone's invite + Mods
  expect(mine.channels).toEqual(['general']); // staff is still admins-only
  expect(mine.channelMeta.general).toMatchObject({ canPost: true });
  const owners = (await (await get('owner', '/spaces')).json()).find((s) => s.name === SPACE);
  expect(owners).toMatchObject({ owner: true, position: 1e9 });
  expect(owners.channels.sort()).toEqual(['general', 'staff']);
  const members = (await (await get('pleb', `/spaces/${SPACE}/members`)).json()).members;
  expect(members.find((m) => m.username === 'mod').position).toBe(2);
  expect(members.find((m) => m.username === 'pleb').position).toBe(0);
  expect(members.find((m) => m.username === 'owner').position).toBe(1e9);
});

test('a custom role with pin_messages lets its holder pin over the gateway; a plain member is refused', async () => {
  const id = Number(db.storeMessage(SPACE, 'general', 'pin me', users.owner.id).id);
  send('pleb', { op: 'pin', id });
  await wait(80);
  expect(framesOf('owner', 'message_pinned')).toEqual([]);
  send('mod', { op: 'pin', id });
  await wait(100);
  expect(framesOf('owner', 'message_pinned').at(-1)).toMatchObject({ id, pinned: true });
});

test('a channel allow for a custom role opens a private channel: history, live frames, counts, search and the server list', async () => {
  const staffId = db.channelRef(SPACE, 'staff').channelId;
  expect((await get('mod', `/spaces/${SPACE}/channels/staff/messages`)).status).toBe(403);
  db.setChannelOverride(staffId, mods.id, { view: 1, post: 1 });
  expect((await get('mod', `/spaces/${SPACE}/channels/staff/messages`)).status).toBe(200);
  expect((await get('pleb', `/spaces/${SPACE}/channels/staff/messages`)).status).toBe(403);
  // Posting works for the holder (a frame reaches the owner), not for the plain member.
  send('mod', { op: 'message', space: SPACE, channel: 'staff', content: 'mod here' });
  send('pleb', { op: 'message', space: SPACE, channel: 'staff', content: 'pleb here' });
  await wait(120);
  expect(framesOf('owner', 'message').map((f) => f.content)).toContain('mod here');
  expect(framesOf('owner', 'message').map((f) => f.content)).not.toContain('pleb here');
  // Live frames reach the role holder only.
  send('owner', { op: 'message', space: SPACE, channel: 'staff', content: 'zebra for @mod and @pleb' });
  await wait(120);
  expect(framesOf('mod', 'message').some((f) => f.channel === 'staff')).toBe(true);
  expect(framesOf('pleb', 'message').some((f) => f.channel === 'staff')).toBe(false);
  // Unread and mention counts, search, and the server list follow the roles.
  const modFrame = await reconnectFrame('mod');
  expect(modFrame.counts.map((c) => c.channel)).toContain('staff');
  expect(modFrame.mentions.map((c) => c.channel)).toContain('staff');
  const plebFrame = await reconnectFrame('pleb');
  expect(plebFrame.counts.map((c) => c.channel)).not.toContain('staff');
  expect(plebFrame.mentions.map((c) => c.channel)).not.toContain('staff');
  expect((await (await get('mod', '/search?q=zebra')).json()).channels.map((m) => m.channel)).toEqual(['staff']);
  expect((await (await get('pleb', '/search?q=zebra')).json()).channels).toEqual([]);
  expect((await (await get('mod', '/spaces')).json()).find((s) => s.name === SPACE).channels.sort()).toEqual(['general', 'staff']);
  // Taking the allow away closes it again.
  db.setChannelOverride(staffId, mods.id, { view: null, post: null });
  expect((await get('mod', `/spaces/${SPACE}/channels/staff/messages`)).status).toBe(403);
});

test('kicking goes by position: a Mod removes a plain member but not someone above', async () => {
  expect((await req('pleb', 'DELETE', `/spaces/${SPACE}/members/helper`)).status).toBe(403); // no kick ability
  const seniors = db.createRole(spaceId, { name: 'Seniors', permissions: [] }); // position 3, above Mods
  db.addMemberRole(spaceId, users.helper.id, seniors.id);
  expect((await req('mod', 'DELETE', `/spaces/${SPACE}/members/helper`)).status).toBe(403);
  db.removeMemberRole(spaceId, users.helper.id, seniors.id);
  expect((await req('mod', 'DELETE', `/spaces/${SPACE}/members/helper`)).status).toBe(200);
  expect(db.isMember(spaceId, users.helper.id)).toBe(false);
  expect((await req('mod', 'DELETE', `/spaces/${SPACE}/members/owner`)).status).toBe(403);
});

test('with no custom roles the tiers behave as before: an admin sees the private channel, a member does not', async () => {
  db.setMemberRole(spaceId, users.pleb.id, 'admin');
  expect((await get('pleb', `/spaces/${SPACE}/channels/staff/messages`)).status).toBe(200);
  db.setMemberRole(spaceId, users.pleb.id, 'member');
  expect((await get('pleb', `/spaces/${SPACE}/channels/staff/messages`)).status).toBe(403);
});
