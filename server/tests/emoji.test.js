// P2-19a: custom server emoji. Managers add an emoji from an upload (an
// image under 256 KB, at most 50 per server); every member sees the list.
const WebSocket = require('ws');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

let serverModule;
let port;
const users = {}; // name -> { token, id, gw, frames }
const SPACE = 'Emojiville';

beforeAll((done) => {
  process.env.PORT = 0;
  process.env.JWT_SECRET = 'disgourd-test-secret-0123456789abcdef';
  process.env.DB_PATH = ':memory:';
  process.env.UPLOADS_DIR = path.join(os.tmpdir(), `disgourd-test-uploads-emoji-${process.pid}`);
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
const auth = (who) => ({ Authorization: `Bearer ${users[who].token}` });
const req = (who, method, p, body) =>
  fetch(`${base()}${p}`, { method, headers: { 'content-type': 'application/json', ...auth(who) }, body: body && JSON.stringify(body) });
const framesOf = (who, type) => users[who].frames.filter((f) => f.type === type);

// A valid 1x1 PNG, padded with a zTXt chunk to the wanted size (still a PNG).
function pngOfSize(bytes) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(Buffer.concat([Buffer.from(type), data])) : 0);
    return Buffer.concat([len, Buffer.from(type), data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const idat = zlib.deflateSync(Buffer.from([0, 0, 0, 0, 0]));
  const head = Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat)]);
  const tail = chunk('IEND', Buffer.alloc(0));
  const padLen = Math.max(0, bytes - head.length - tail.length - 12);
  return Buffer.concat([head, chunk('tEXt', Buffer.alloc(padLen, 0x61)), tail]);
}

async function upload(who, name, body) {
  const res = await fetch(`${base()}/uploads?name=${encodeURIComponent(name)}`, { method: 'POST', headers: auth(who), body });
  return (await res.json()).url;
}

async function register(username) {
  const res = await fetch(`${base()}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'gourd-test-pass-1', email: `${username}@example.com` }),
  });
  return (await res.json()).token;
}

beforeAll(async () => {
  const { db } = serverModule;
  for (const name of ['owner', 'admin', 'member', 'outsider']) {
    const token = await register(name);
    users[name] = { token, id: db.getUserByUsername(name).id, frames: [] };
  }
  const spaceId = db.createSpaceWithDefaults(SPACE, users.owner.id);
  db.addMember(spaceId, users.admin.id, 'admin');
  db.addMember(spaceId, users.member.id, 'member');
  db.createSpaceWithDefaults('Elsewhere', users.outsider.id);
  for (const u of Object.values(users)) {
    u.gw = new WebSocket(`ws://localhost:${port}/gateway?token=${u.token}`);
    u.gw.on('message', (raw) => u.frames.push(JSON.parse(raw.toString())));
    await new Promise((r) => u.gw.on('open', r));
  }
  await wait(80);
});

let smallUrl;

test('an admin adds an emoji from an upload; members see it in the list, in GET /spaces and over the gateway', async () => {
  smallUrl = await upload('admin', 'party.png', pngOfSize(2000));
  const res = await req('admin', 'POST', `/spaces/${SPACE}/emoji`, { name: 'Party_Gourd', url: smallUrl });
  expect(res.status).toBe(201);
  expect(await res.json()).toMatchObject({ name: 'party_gourd', url: smallUrl, createdBy: 'admin' });
  await wait(60);
  expect(framesOf('member', 'space_updated').at(-1)).toEqual({ type: 'space_updated', space: SPACE });
  const list = await (await fetch(`${base()}/spaces/${SPACE}/emoji`, { headers: auth('member') })).json();
  expect(list.map((e) => e.name)).toEqual(['party_gourd']);
  const spaces = await (await fetch(`${base()}/spaces`, { headers: auth('member') })).json();
  expect(spaces.find((s) => s.name === SPACE).emoji).toEqual([{ id: expect.any(Number), name: 'party_gourd', url: smallUrl }]);
  expect(spaces.find((s) => s.name === SPACE).permissions.manage_emoji).toBe(2);
});

test('only people with manage_emoji may add or remove; outsiders cannot even list', async () => {
  expect((await req('member', 'POST', `/spaces/${SPACE}/emoji`, { name: 'nope', url: smallUrl })).status).toBe(403);
  expect((await req('member', 'DELETE', `/spaces/${SPACE}/emoji/party_gourd`)).status).toBe(403);
  expect((await fetch(`${base()}/spaces/${SPACE}/emoji`, { headers: auth('outsider') })).status).toBe(403);
  // The owner can open it up to everyone.
  const perms = (await (await fetch(`${base()}/spaces/${SPACE}/permissions`, { headers: auth('owner') })).json()).permissions;
  await req('owner', 'PUT', `/spaces/${SPACE}/permissions`, { ...perms, manage_emoji: 1 });
  expect((await req('member', 'POST', `/spaces/${SPACE}/emoji`, { name: 'member_made', url: smallUrl })).status).toBe(201);
  await req('owner', 'PUT', `/spaces/${SPACE}/permissions`, { ...perms, manage_emoji: 2 });
});

test('names, URLs and files are checked', async () => {
  const bad = async (body) => (await req('admin', 'POST', `/spaces/${SPACE}/emoji`, body)).status;
  expect(await bad({ name: 'x', url: smallUrl })).toBe(400); // too short
  expect(await bad({ name: 'has space', url: smallUrl })).toBe(400);
  expect(await bad({ name: 'a'.repeat(33), url: smallUrl })).toBe(400);
  expect(await bad({ name: 'fine', url: 'https://example.com/x.png' })).toBe(400); // not one of our uploads
  expect(await bad({ name: 'fine', url: '/uploads/../../etc/passwd' })).toBe(400);
  expect(await bad({ name: 'fine', url: '/uploads/doesnotexist/x.png' })).toBe(400);
  const textUrl = await upload('admin', 'notes.txt', Buffer.from('hello'));
  expect(await bad({ name: 'fine', url: textUrl })).toBe(400); // not an image
  const bigUrl = await upload('admin', 'big.png', pngOfSize(300 * 1024));
  expect(await bad({ name: 'fine', url: bigUrl })).toBe(413);
  expect(await bad({ name: 'party_gourd', url: smallUrl })).toBe(409); // taken (case-insensitive)
  expect(await bad({ name: 'PARTY_GOURD', url: smallUrl })).toBe(409);
});

test('at most 50 emoji per server', async () => {
  const { db } = serverModule;
  const space = db.getSpaceByName(SPACE);
  const have = db.getSpaceEmoji(space.id).length;
  for (let i = have; i < 50; i++) db.addSpaceEmoji(space.id, `filler_${i}`, smallUrl, users.admin.id);
  expect(db.getSpaceEmoji(space.id)).toHaveLength(50);
  const res = await req('admin', 'POST', `/spaces/${SPACE}/emoji`, { name: 'one_too_many', url: smallUrl });
  expect(res.status).toBe(409);
  expect((await res.json()).error).toMatch(/50/);
});

test('delete removes one; a second delete is 404; servers never see each other\'s emoji', async () => {
  expect((await req('owner', 'DELETE', `/spaces/${SPACE}/emoji/filler_49`)).status).toBe(200);
  await wait(60);
  expect(framesOf('member', 'space_updated').length).toBeGreaterThan(1);
  expect((await req('owner', 'DELETE', `/spaces/${SPACE}/emoji/filler_49`)).status).toBe(404);
  const list = await (await fetch(`${base()}/spaces/${SPACE}/emoji`, { headers: auth('member') })).json();
  expect(list.map((e) => e.name)).not.toContain('filler_49');
  const other = await (await fetch(`${base()}/spaces/Elsewhere/emoji`, { headers: auth('outsider') })).json();
  expect(other).toEqual([]);
});

test('a custom emoji reacts as <:name:id> when it exists in this server, and is ignored otherwise (P2-19b)', async () => {
  const { db } = serverModule;
  const space = db.getSpaceByName(SPACE);
  const party = db.getSpaceEmoji(space.id).find((e) => e.name === 'party_gourd');
  const other = db.getSpaceByName('Elsewhere');
  const foreign = db.addSpaceEmoji(other.id, 'foreign', smallUrl, users.outsider.id);
  const msgId = Number(db.storeMessage(SPACE, 'general', 'react with the gourd', users.owner.id).id);
  const send = (who, emoji) => users[who].gw.send(JSON.stringify({ op: 'react', id: msgId, emoji }));
  users.owner.frames.length = 0;
  send('member', `<:party_gourd:${party.id}>`);
  await wait(100);
  expect(framesOf('owner', 'reaction').at(-1)).toMatchObject({ id: msgId, emoji: `<:party_gourd:${party.id}>`, count: 1, users: ['member'] });
  users.owner.frames.length = 0;
  send('member', `<:party_gourd:${party.id + 1000}>`); // wrong id
  send('member', `<:not_the_name:${party.id}>`); // wrong name
  send('member', `<:foreign:${foreign.id}>`); // another server's emoji
  send('member', '<:party_gourd:abc>'); // not a token at all
  await wait(100);
  expect(framesOf('owner', 'reaction')).toEqual([]);
  const rows = await (await fetch(`${base()}/spaces/${SPACE}/channels/general/messages?limit=5`, { headers: auth('member') })).json();
  expect(rows.find((m) => m.id === msgId).reactions).toEqual([{ emoji: `<:party_gourd:${party.id}>`, count: 1, users: ['member'] }]);
});

test('deleting the server removes its emoji rows', async () => {
  const { db } = serverModule;
  const id = db.createSpaceWithDefaults('Temporary', users.owner.id);
  db.addSpaceEmoji(id, 'gone_soon', smallUrl, users.owner.id);
  expect(db.getSpaceEmoji(id)).toHaveLength(1);
  await req('owner', 'DELETE', '/spaces/Temporary');
  expect(db.raw.prepare('SELECT COUNT(*) AS n FROM space_emoji WHERE space_id = ?').get(id).n).toBe(0);
});
