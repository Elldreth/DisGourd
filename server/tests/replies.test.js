// P2-09: replies to channel messages.
const WebSocket = require('ws');
const os = require('os');
const path = require('path');

let serverModule;
let port;
const users = {}; // name -> { token, id, gw }

beforeAll((done) => {
  process.env.PORT = 0;
  process.env.JWT_SECRET = 'disgourd-test-secret-0123456789abcdef';
  process.env.DB_PATH = ':memory:';
  process.env.UPLOADS_DIR = path.join(os.tmpdir(), `disgourd-test-uploads-reply-${process.pid}`);
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

const history = (token, channel) =>
  fetch(`http://localhost:${port}/spaces/Replyville/channels/${channel}/messages?limit=50`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json());

beforeAll(async () => {
  const { db } = serverModule;
  for (const name of ['ana', 'ben']) {
    const token = await register(name);
    users[name] = { token, id: db.getUserByUsername(name).id };
  }
  const spaceId = db.createSpaceWithDefaults('Replyville', users.ana.id);
  db.addMember(spaceId, users.ben.id, 'member');
  db.createChannel('Replyville', 'random');
  db.createChannel('Replyville', 'secret');
  db.setChannelPerms('Replyville', 'secret', 3, 3); // owner (ana) only
  for (const u of Object.values(users)) {
    u.gw = gateway(u.token);
    await u.gw.ready;
  }
});

const post = (author, content, channel = 'general') =>
  serverModule.db.storeMessage('Replyville', channel, content, users[author].id).id;

async function reply(author, replyTo, content, channel = 'general') {
  users[author].gw.send({ op: 'message', space: 'Replyville', channel, content, replyTo });
  await wait(150);
  return users[author].gw.frames.filter((f) => f.type === 'message' && f.content === content).pop();
}

test('a reply is stored, broadcast and returned in history with its original', async () => {
  const original = post('ana', 'what should we play tonight? '.repeat(6));
  const frame = await reply('ben', original, 'minecraft!');
  expect(frame.replyTo).toEqual({
    id: original,
    authorId: users.ana.id,
    author: 'ana',
    snippet: 'what should we play tonight? '.repeat(6).slice(0, 100),
  });
  const rows = await history(users.ben.token, 'general');
  const stored = rows.find((m) => m.content === 'minecraft!');
  expect(stored.replyTo).toEqual(frame.replyTo);
  expect(rows.find((m) => m.id === original).replyTo).toBeNull();
});

test('spoilers are hidden and attachments summarised in the quote', async () => {
  const spoiled = post('ana', 'the ending: ||they all die||');
  expect((await reply('ben', spoiled, 'noo')).replyTo.snippet).toBe('the ending: (spoiler)');
  const pic = serverModule.db.storeMessage('Replyville', 'general', '', users.ana.id, ['/uploads/x/cat.png']).id;
  expect((await reply('ben', pic, 'cute')).replyTo.snippet).toBe('Attachment');
});

test('a replyTo from another channel is ignored', async () => {
  const elsewhere = post('ana', 'over in random', 'random');
  const frame = await reply('ben', elsewhere, 'wrong channel');
  expect(frame).toBeTruthy();
  expect(frame.replyTo).toBeNull();
});

test('a private-channel original cannot be quoted into a public channel', async () => {
  const secret = post('ana', 'owners only secret', 'secret');
  const frame = await reply('ben', secret, 'trying to peek');
  expect(frame.replyTo).toBeNull();
  const rows = await history(users.ben.token, 'general');
  expect(JSON.stringify(rows)).not.toMatch(/owners only secret/);
});

test('garbage replyTo values are ignored', async () => {
  for (const bad of ['abc', { id: 1 }, -5, 999999]) {
    users.ben.gw.send({ op: 'message', space: 'Replyville', channel: 'general', content: `bad ${JSON.stringify(bad)}`, replyTo: bad });
  }
  await wait(200);
  const frames = users.ben.gw.frames.filter((f) => f.type === 'message' && f.content.startsWith('bad '));
  expect(frames).toHaveLength(4);
  expect(frames.every((f) => f.replyTo === null)).toBe(true);
});

test('deleting the original keeps the reply and marks the quote deleted', async () => {
  const original = post('ben', 'delete me later');
  await reply('ana', original, 'replying to soon-deleted');
  serverModule.db.deleteMessageById(original);
  const rows = await history(users.ana.token, 'general');
  const r = rows.find((m) => m.content === 'replying to soon-deleted');
  expect(r).toBeTruthy();
  expect(r.replyTo).toEqual({ id: original, deleted: true });
});

test('replying notifies the original author with a mention', async () => {
  const { db } = serverModule;
  const original = post('ana', 'anyone around?', 'random');
  db.markRead(users.ana.id, 'Replyville', 'random', original);
  const frame = await reply('ben', original, 'yep', 'random');
  expect(frame.mentions).toEqual(['ana']);
  const counts = db.getMentionCounts(users.ana.id);
  expect(counts.find((c) => c.channel === 'random')?.count).toBe(1);
  // Replying to yourself doesn't mention you.
  const own = await reply('ben', frame.id, 'and me again', 'random');
  expect(own.mentions).toEqual([]);
});
