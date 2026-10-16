// P2-05: the `unread` frame sent on connect tells the client where you stopped
// reading each channel (lastReadId), so it can draw a "New" divider there.
const WebSocket = require('ws');
const os = require('os');
const path = require('path');

let serverModule;
let port;
const users = {}; // name -> { token, id }

beforeAll((done) => {
  process.env.PORT = 0;
  process.env.JWT_SECRET = 'disgourd-test-secret-0123456789abcdef';
  process.env.DB_PATH = ':memory:';
  process.env.UPLOADS_DIR = path.join(os.tmpdir(), `disgourd-test-uploads-divider-${process.pid}`);
  serverModule = require('../server');
  serverModule.httpServer.listen(0, () => {
    port = serverModule.httpServer.address().port;
    done();
  });
});

afterAll((done) => {
  serverModule.httpServer.close(done);
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function register(username) {
  const res = await fetch(`http://localhost:${port}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'password123', email: `${username}@example.com` }),
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
  return { frames, ready, send: (obj) => ws.send(JSON.stringify(obj)), close: () => ws.close() };
}

beforeAll(async () => {
  const { db } = serverModule;
  for (const name of ['dee', 'eli']) {
    const token = await register(name);
    users[name] = { token, id: db.getUserByUsername(name).id };
  }
  const spaceId = db.createSpaceWithDefaults('Dividers', users.dee.id);
  db.addMember(spaceId, users.eli.id, 'member');
  db.createChannel('Dividers', 'quiet');
});

const post = (name, content, channel = 'general') =>
  Number(serverModule.db.storeMessage('Dividers', channel, content, users[name].id).id);

async function unreadFrameFor(name) {
  const gw = gateway(users[name].token);
  await gw.ready;
  await wait(80);
  gw.close();
  return gw.frames.find((f) => f.type === 'unread');
}

test('each unread row carries the id of the last message you read there', async () => {
  const first = post('eli', 'one');
  // Dee reads up to `first` over the gateway, the way the app does.
  const gw = gateway(users.dee.token);
  await gw.ready;
  gw.send({ op: 'read', space: 'Dividers', channel: 'general', lastId: first });
  await wait(80);
  gw.close();
  post('eli', 'two');
  post('eli', 'three');

  const frame = await unreadFrameFor('dee');
  const row = frame.counts.find((c) => c.space === 'Dividers' && c.channel === 'general');
  expect(row).toEqual({ space: 'Dividers', channel: 'general', count: 2, lastReadId: first });
});

test('a channel you have never read reports lastReadId 0', async () => {
  post('dee', 'hello quiet', 'quiet');
  const frame = await unreadFrameFor('eli');
  const row = frame.counts.find((c) => c.space === 'Dividers' && c.channel === 'quiet');
  expect(row.lastReadId).toBe(0);
});
