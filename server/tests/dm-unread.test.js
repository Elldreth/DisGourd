// P1-11: the dm_unread frame sent on connect must key each count by the other
// user under `with`, the same name the client and the other DM ops use.
const WebSocket = require('ws');
const os = require('os');
const path = require('path');

let serverModule;
let port;

beforeAll((done) => {
  process.env.PORT = 0;
  process.env.JWT_SECRET = 'disgourd-test-secret-0123456789abcdef';
  process.env.DB_PATH = ':memory:';
  process.env.UPLOADS_DIR = path.join(os.tmpdir(), `disgourd-test-uploads-dm-${process.pid}`);
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
  return { frames, ready, send: (obj) => ws.send(JSON.stringify(obj)), close: () => ws.close() };
}

test('dm_unread on connect keys counts by `with`', async () => {
  const alice = await register('alice');
  const bob = await register('bob');
  // P11-09: they share a server, so bob can start a DM with alice.
  const { db } = serverModule;
  db.addMember(db.createSpaceWithDefaults('Unread', db.getUserByUsername('alice').id), db.getUserByUsername('bob').id, 'member');

  // Bob DMs Alice twice while Alice is offline.
  const bg = gateway(bob);
  await bg.ready;
  bg.send({ op: 'dm', to: 'alice', content: 'one' });
  bg.send({ op: 'dm', to: 'alice', content: 'two' });
  await wait(120);
  bg.close();

  const ag = gateway(alice);
  await ag.ready;
  await wait(80);
  const frame = ag.frames.find((f) => f.type === 'dm_unread');
  ag.close();

  expect(frame).toBeTruthy();
  expect(frame.counts).toEqual([{ conversation: expect.any(Number), with: 'bob', count: 2 }]); // P9-06a: and its conversation
});
