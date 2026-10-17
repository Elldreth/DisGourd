// P2-07: any single emoji can be a reaction (including long ZWJ sequences and
// flags); text, several emoji, or junk are refused rather than trimmed.
const WebSocket = require('ws');
const os = require('os');
const path = require('path');

let serverModule;
let port;
const users = {};
const open = [];

beforeAll((done) => {
  process.env.PORT = 0;
  process.env.JWT_SECRET = 'disgourd-test-secret-0123456789abcdef';
  process.env.DB_PATH = ':memory:';
  process.env.UPLOADS_DIR = path.join(os.tmpdir(), `disgourd-test-uploads-react-${process.pid}`);
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
  const g = { frames, ready, send: (obj) => ws.send(JSON.stringify(obj)) };
  open.push({ close: () => ws.close() });
  return g;
}

let msgId;
let ana;
let ben;
beforeAll(async () => {
  const { db } = serverModule;
  for (const name of ['ana', 'ben']) {
    const token = await register(name);
    users[name] = { token, id: db.getUserByUsername(name).id };
  }
  const spaceId = db.createSpaceWithDefaults('Reacts', users.ana.id);
  db.addMember(spaceId, users.ben.id, 'member');
  msgId = Number(db.storeMessage('Reacts', 'general', 'react to me', users.ana.id).id);
  ana = gateway(users.ana.token);
  ben = gateway(users.ben.token);
  await Promise.all([ana.ready, ben.ready]);
});

async function react(emoji) {
  ana.frames.length = 0;
  ben.frames.length = 0;
  ana.send({ op: 'react', id: msgId, emoji });
  await wait(100);
  return ben.frames.find((f) => f.type === 'reaction');
}

test.each([
  ['a new emoji', '🫠'],
  ['a family (ZWJ sequence, 11 units)', '👨‍👩‍👧‍👦'],
  ['a couple with skin tones (15 units)', '👩🏻‍❤️‍💋‍👨🏼'],
  ['a subdivision flag (tag sequence, 14 units)', '🏴󠁧󠁢󠁥󠁮󠁧󠁿'],
  ['a country flag', '🇺🇸'],
  ['a keycap', '1️⃣'],
])('%s is accepted and others see it', async (_, emoji) => {
  const frame = await react(emoji);
  expect(frame).toMatchObject({ id: msgId, emoji, count: 1, users: ['ana'] });
  // It's stored: the message history carries it.
  const rows = await fetch(`http://localhost:${port}/spaces/Reacts/channels/general/messages?limit=5`, {
    headers: { Authorization: `Bearer ${users.ben.token}` },
  }).then((r) => r.json());
  expect(rows.find((m) => m.id === msgId).reactions.map((r) => r.emoji)).toContain(emoji);
});

test.each([
  ['plain text', 'ab'],
  ['two emoji', '👍👍'],
  ['an emoji with text', '🔥lol'],
  ['a long sentence', 'this is not a reaction at all'],
  ['an empty string', '   '],
  ['a non-string', 42],
])('%s is refused (not trimmed into a reaction)', async (_, emoji) => {
  expect(await react(emoji)).toBeUndefined();
});

test('surrounding spaces are ignored', async () => {
  expect(await react('  🎉 ')).toMatchObject({ emoji: '🎉' });
});
