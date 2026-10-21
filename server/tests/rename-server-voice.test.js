// P6-04: renaming a server moves its voice rooms, so calls carry on under the
// new name; other servers' rooms are untouched.
const WebSocket = require('ws');
const os = require('os');
const path = require('path');

let serverModule;
let port;
const SPACE = 'Voiceland';

beforeAll((done) => {
  process.env.PORT = 0;
  process.env.JWT_SECRET = 'disgourd-test-secret-0123456789abcdef';
  process.env.DB_PATH = ':memory:';
  process.env.UPLOADS_DIR = path.join(os.tmpdir(), `disgourd-test-uploads-rename-server-${process.pid}`);
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
  return { frames, ready, send: (o) => ws.send(JSON.stringify(o)), close: () => ws.close() };
}

const call = async (who, method, p, body) => {
  const res = await fetch(`http://localhost:${port}${p}`, {
    method,
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${users[who].token}` },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const clearFrames = () => { for (const u of Object.values(users)) if (u.gw) u.gw.frames.length = 0; };
const states = (who) => users[who].gw.frames.filter((f) => f.type === 'voice_state');

beforeAll(async () => {
  const { db } = serverModule;
  for (const name of ['owner', 'member', 'other']) {
    const token = await register(name);
    users[name] = { token, id: db.getUserByUsername(name).id };
  }
  const id = db.createSpaceWithDefaults(SPACE, users.owner.id);
  db.addMember(id, users.member.id, 'member');
  db.createChannel(SPACE, 'lounge', 'voice');
  db.createSpaceWithDefaults('Elsewhere', users.other.id);
  db.createChannel('Elsewhere', 'lounge', 'voice');
  for (const name of ['owner', 'member', 'other']) {
    users[name].gw = gateway(users[name].token);
    await users[name].gw.ready;
  }
  users.member.gw.send({ op: 'voice_join', space: SPACE, channel: 'lounge' });
  users.other.gw.send({ op: 'voice_join', space: 'Elsewhere', channel: 'lounge' });
  await wait(150);
});

test('a call in a renamed server carries on under the new name', async () => {
  clearFrames();
  const res = await call('owner', 'PATCH', `/spaces/${SPACE}`, { name: 'Studio' });
  expect(res.status).toBe(200);
  await wait(150);
  const f = users.member.gw.frames;
  const renamedAt = f.findIndex((x) => x.type === 'space_renamed');
  expect(f[renamedAt]).toEqual({ type: 'space_renamed', space: SPACE, newName: 'Studio' });
  const last = states('member').at(-1);
  expect(last).toMatchObject({ space: 'Studio', channel: 'lounge', participants: [expect.objectContaining({ username: 'member' })] });
  expect(f.indexOf(last)).toBeGreaterThan(renamedAt);
  expect(f.some((x) => x.type === 'voice_ended')).toBe(false);
  // The other server's call wasn't touched.
  expect(states('other')).toHaveLength(0);
});

test('the moved room works: a new connection sees it, and mute reaches it', async () => {
  const late = gateway(users.owner.token);
  await late.ready;
  await wait(150);
  expect(late.frames.find((x) => x.type === 'voice_state' && x.space === 'Studio')?.participants).toHaveLength(1);
  expect(late.frames.some((x) => x.type === 'voice_state' && x.space === SPACE)).toBe(false);
  late.close();
  clearFrames();
  users.member.gw.send({ op: 'voice_mute', muted: true });
  await wait(150);
  expect(states('owner').find((x) => x.space === 'Studio')?.participants[0].muted).toBe(true);
});

test('leaving after the rename empties the room under the new name', async () => {
  clearFrames();
  users.member.gw.send({ op: 'voice_leave' });
  await wait(150);
  expect(states('owner').at(-1)).toMatchObject({ space: 'Studio', channel: 'lounge', participants: [] });
});
