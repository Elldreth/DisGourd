// P1-09: a (re)connecting client learns who is already in voice straight
// away, instead of seeing empty voice channels until someone joins or leaves.
const WebSocket = require('ws');
const os = require('os');
const path = require('path');

let serverModule;
let port;
const users = {}; // name -> { token, id }
const open = [];

beforeAll((done) => {
  process.env.PORT = 0;
  process.env.JWT_SECRET = 'disgourd-test-secret-0123456789abcdef';
  process.env.DB_PATH = ':memory:';
  process.env.UPLOADS_DIR = path.join(os.tmpdir(), `disgourd-test-uploads-reconnect-${process.pid}`);
  serverModule = require('../server');
  serverModule.httpServer.listen(0, () => {
    port = serverModule.httpServer.address().port;
    done();
  });
});

afterAll((done) => {
  for (const g of open) g.close();
  serverModule.httpServer.close(done);
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

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
  const g = { frames, ready, send: (obj) => ws.send(JSON.stringify(obj)), close: () => ws.close() };
  open.push(g);
  return g;
}

beforeAll(async () => {
  const { db } = serverModule;
  for (const name of ['ava', 'bea', 'cyd']) {
    const token = await register(name);
    users[name] = { token, id: db.getUserByUsername(name).id };
  }
  const spaceId = db.createSpaceWithDefaults('Echo', users.ava.id);
  db.addMember(spaceId, users.bea.id, 'member');
  db.createChannel('Echo', 'lounge', 'voice');
  db.createChannel('Echo', 'backstage', 'voice');
  db.setChannelPerms('Echo', 'backstage', 3, 3); // owner (ava) only
  db.createChannel('Echo', 'empty', 'voice');
});

test('connecting sends voice_state for each occupied voice room you can see', async () => {
  const ga = gateway(users.ava.token);
  await ga.ready;
  ga.send({ op: 'voice_join', space: 'Echo', channel: 'lounge' });
  await wait(100);

  const gb = gateway(users.bea.token);
  await gb.ready;
  await wait(100);
  const states = gb.frames.filter((f) => f.type === 'voice_state');
  expect(states).toHaveLength(1);
  expect(states[0]).toMatchObject({ space: 'Echo', channel: 'lounge' });
  expect(states[0].participants.map((p) => p.username)).toEqual(['ava']);
  // It comes with the other connect frames, right after the unread counts.
  const types = gb.frames.map((f) => f.type);
  expect(types.indexOf('voice_state')).toBeGreaterThan(types.indexOf('dm_unread'));
  gb.close();
  ga.close();
  await wait(100);
});

test('rooms you cannot see, servers you are not in, and empty rooms are left out', async () => {
  const ga = gateway(users.ava.token);
  await ga.ready;
  ga.send({ op: 'voice_join', space: 'Echo', channel: 'backstage' });
  await wait(100);

  const gb = gateway(users.bea.token); // member, but backstage is owner-only
  const gc = gateway(users.cyd.token); // not in the server at all
  await Promise.all([gb.ready, gc.ready]);
  await wait(100);
  expect(gb.frames.filter((f) => f.type === 'voice_state')).toEqual([]);
  expect(gc.frames.filter((f) => f.type === 'voice_state')).toEqual([]);
});

test('rejoining from a new socket while the old one lingers: others drop the stale link first', async () => {
  const gb = gateway(users.bea.token);
  await gb.ready;
  gb.send({ op: 'voice_join', space: 'Echo', channel: 'lounge' });
  const ga1 = gateway(users.ava.token);
  await ga1.ready;
  ga1.send({ op: 'voice_join', space: 'Echo', channel: 'lounge' });
  await wait(100);
  gb.frames.length = 0;

  // Ava reconnects on a new socket before the server notices the old one died.
  const ga2 = gateway(users.ava.token);
  await ga2.ready;
  ga2.send({ op: 'voice_join', space: 'Echo', channel: 'lounge' });
  await wait(100);

  const seq = gb.frames.filter((f) => f.type === 'voice_peer_left' || f.type === 'voice_peer_joined');
  expect(seq.map((f) => f.type)).toEqual(['voice_peer_left', 'voice_peer_joined']);
  expect(seq[0].userId).toBe(users.ava.id);
  const roster = gb.frames.filter((f) => f.type === 'voice_state').pop();
  expect(roster.participants.map((p) => p.username).sort()).toEqual(['ava', 'bea']);

  // The old socket finally closes: it must not knock Ava out of the room.
  ga1.close();
  await wait(100);
  const after = gb.frames.filter((f) => f.type === 'voice_state').pop();
  expect(after.participants.map((p) => p.username).sort()).toEqual(['ava', 'bea']);
  ga2.close();
  gb.close();
  await wait(100);
});
