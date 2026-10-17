// P2-13: pinned messages in channels.
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
  process.env.UPLOADS_DIR = path.join(os.tmpdir(), `disgourd-test-uploads-pins-${process.pid}`);
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
const get = (who, p) => fetch(`${base()}${p}`, { headers: { Authorization: `Bearer ${users[who].token}` } });
const send = (who, frame) => users[who].gw.send(JSON.stringify(frame));
const pinFrames = (who) => users[who].frames.filter((f) => f.type === 'message_pinned');

async function register(username) {
  const res = await fetch(`${base()}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'password123', email: `${username}@example.com` }),
  });
  return (await res.json()).token;
}

const post = (who, content, channel = 'general') => serverModule.db.storeMessage('Pinland', channel, content, users[who].id).id;

beforeAll(async () => {
  const { db } = serverModule;
  for (const name of ['owner', 'admin', 'member', 'stranger']) {
    const token = await register(name);
    users[name] = { token, id: db.getUserByUsername(name).id, frames: [] };
  }
  const spaceId = db.createSpaceWithDefaults('Pinland', users.owner.id);
  db.addMember(spaceId, users.admin.id, 'admin');
  db.addMember(spaceId, users.member.id, 'member');
  db.createChannel('Pinland', 'staff');
  db.setChannelPerms('Pinland', 'staff', 2, 2);
  db.createChannel('Pinland', 'busy');
  for (const u of Object.values(users)) {
    u.gw = new WebSocket(`ws://localhost:${port}/gateway?token=${u.token}`);
    u.gw.on('message', (raw) => u.frames.push(JSON.parse(raw.toString())));
    await new Promise((r) => u.gw.on('open', r));
  }
  await wait(80);
});

test('an admin pins: viewers are told, history marks it, and the pins list has it', async () => {
  const id = post('member', 'the rules: be nice');
  send('admin', { op: 'pin', id });
  await wait(100);
  for (const who of ['owner', 'admin', 'member']) {
    expect(pinFrames(who).at(-1)).toMatchObject({ id: Number(id), space: 'Pinland', channel: 'general', pinned: true, pinnedBy: 'admin' });
  }
  expect(pinFrames('stranger')).toEqual([]);
  const history = await (await get('member', '/spaces/Pinland/channels/general/messages')).json();
  expect(history.find((m) => Number(m.id) === Number(id)).pinned).toBe(true);
  const pins = await (await get('member', '/spaces/Pinland/channels/general/pins')).json();
  expect(pins).toEqual([expect.objectContaining({ id: Number(id), content: 'the rules: be nice', author: 'member', pinnedBy: 'admin' })]);
  expect(typeof pins[0].pinnedAt).toBe('number');
});

test('pins come newest-pinned first, and unpin removes one', async () => {
  const first = post('owner', 'first pinned');
  const second = post('owner', 'second pinned');
  send('owner', { op: 'pin', id: first });
  await wait(30);
  send('owner', { op: 'pin', id: second });
  await wait(80);
  let pins = await (await get('owner', '/spaces/Pinland/channels/general/pins')).json();
  expect(pins.slice(0, 2).map((m) => m.content)).toEqual(['second pinned', 'first pinned']);
  send('admin', { op: 'unpin', id: second });
  await wait(80);
  expect(pinFrames('member').at(-1)).toMatchObject({ id: Number(second), pinned: false });
  pins = await (await get('owner', '/spaces/Pinland/channels/general/pins')).json();
  expect(pins.map((m) => m.content)).not.toContain('second pinned');
});

test('a member cannot pin by default; the owner can open it up', async () => {
  const id = post('member', 'please pin me');
  const before = pinFrames('owner').length;
  send('member', { op: 'pin', id });
  await wait(80);
  expect(pinFrames('owner').length).toBe(before);
  expect(users.member.frames.filter((f) => f.type === 'error' && f.op === 'pin').at(-1).error).toMatch(/permission/i);

  const { db } = serverModule;
  db.setSpacePermissions(db.getSpaceByName('Pinland').id, { pin_messages: 1 });
  send('member', { op: 'pin', id });
  await wait(80);
  expect(pinFrames('owner').at(-1)).toMatchObject({ id: Number(id), pinned: true, pinnedBy: 'member' });
  db.setSpacePermissions(db.getSpaceByName('Pinland').id, { pin_messages: 2 });
});

test('deleting a pinned message removes its pin', async () => {
  const id = post('admin', 'temporary');
  send('admin', { op: 'pin', id });
  await wait(60);
  send('admin', { op: 'delete', id });
  await wait(80);
  const pins = await (await get('owner', '/spaces/Pinland/channels/general/pins')).json();
  expect(pins.map((m) => Number(m.id))).not.toContain(Number(id));
  expect(serverModule.db.raw.prepare('SELECT COUNT(*) AS n FROM pins WHERE message_id = ?').get(id).n).toBe(0);
});

test('a channel holds at most 50 pins', async () => {
  const ids = Array.from({ length: 51 }, (_, i) => post('owner', `pin ${i}`, 'busy'));
  for (const id of ids.slice(0, 50)) serverModule.db.pinMessage(id, users.owner.id);
  send('owner', { op: 'pin', id: ids[50] });
  await wait(80);
  expect(users.owner.frames.filter((f) => f.type === 'error' && f.op === 'pin').at(-1).error).toMatch(/50/);
  const pins = await (await get('owner', '/spaces/Pinland/channels/busy/pins')).json();
  expect(pins).toHaveLength(50);
});

test("people who can't see the channel can't list or change its pins", async () => {
  const id = post('admin', 'staff only', 'staff');
  expect((await get('member', '/spaces/Pinland/channels/staff/pins')).status).toBe(403);
  expect((await get('stranger', '/spaces/Pinland/channels/general/pins')).status).toBe(403);
  // A member who somehow knows the id still can't pin it (can't see it).
  serverModule.db.setSpacePermissions(serverModule.db.getSpaceByName('Pinland').id, { pin_messages: 1 });
  send('member', { op: 'pin', id });
  await wait(80);
  expect((await (await get('owner', '/spaces/Pinland/channels/staff/pins')).json())).toEqual([]);
  serverModule.db.setSpacePermissions(serverModule.db.getSpaceByName('Pinland').id, { pin_messages: 2 });
});

test('pin_messages is a server permission with a default of admins', async () => {
  const { db } = serverModule;
  expect(db.getSpacePermissions(db.getSpaceByName('Pinland').id).pin_messages).toBe(2);
});
