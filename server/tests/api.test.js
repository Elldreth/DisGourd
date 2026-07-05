const fetch = global.fetch || ((...args) => import('node-fetch').then(({default:fetch}) => fetch(...args)));
const WebSocket = require('ws');
const fs = require('fs');
const os = require('os');
const path = require('path');

let serverModule;
let port;
const testUploadsDir = path.join(os.tmpdir(), `disgourd-test-uploads-${process.pid}`);

beforeAll(done => {
  process.env.PORT = 0;
  process.env.JWT_SECRET = 'testsecret';
  process.env.DB_PATH = ':memory:';
  process.env.UPLOADS_DIR = testUploadsDir;
  process.env.MAX_UPLOAD_BYTES = '256'; // small so the oversize path is testable
  serverModule = require('../server');
  serverModule.httpServer.listen(0, () => {
    port = serverModule.httpServer.address().port;
    done();
  });
});

afterAll(done => {
  fs.rm(testUploadsDir, { recursive: true, force: true }, () => {
    serverModule.httpServer.close(done);
  });
});

// ---- helpers ----
const baseUrl = () => `http://localhost:${port}`;
const JSON_HEADERS = { 'content-type': 'application/json' };
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function register(username, password = 'password123') {
  const res = await fetch(`${baseUrl()}/register`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ username, password, email: `${username}@example.com` }),
  });
  return res.json();
}

// Create a server (owner = token holder); a #general channel is created too.
function createServer(token, name) {
  return fetch(`${baseUrl()}/spaces`, {
    method: 'POST',
    headers: { ...JSON_HEADERS, ...auth(token) },
    body: JSON.stringify({ name }),
  });
}

// Open the per-user gateway socket and record every frame it receives.
function gateway(token) {
  const ws = new WebSocket(`ws://localhost:${port}/gateway?token=${token}`);
  const frames = [];
  ws.on('message', (raw) => frames.push(JSON.parse(raw.toString())));
  const ready = new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });
  return {
    frames,
    ready,
    send: (obj) => ws.send(JSON.stringify(obj)),
    close: () => ws.close(),
  };
}

function messages(token, space, channel, query = '') {
  return fetch(`${baseUrl()}/spaces/${space}/channels/${channel}/messages${query}`, { headers: auth(token) })
    .then((r) => r.json());
}

test('register, login, create a server and store messages', async () => {
  const base = baseUrl();
  let res = await fetch(`${base}/register`, {
    method: 'POST', headers: JSON_HEADERS,
    body: JSON.stringify({ username: 'alice', password: 'password123', email: 'a@b.c' })
  });
  expect(res.status).toBe(201);

  res = await fetch(`${base}/login`, {
    method: 'POST', headers: JSON_HEADERS,
    body: JSON.stringify({ username: 'alice', password: 'password123' })
  });
  expect(res.status).toBe(200);
  const { token } = await res.json();
  expect(token).toBeTruthy();

  expect((await createServer(token, 'test')).status).toBe(201);

  const gw = gateway(token);
  await gw.ready;
  gw.send({ op: 'message', space: 'test', channel: 'general', content: 'hello' });
  await wait(80);
  gw.close();

  const msgs = await messages(token, 'test', 'general', '?limit=1');
  expect(msgs.length).toBe(1);
  expect(msgs[0].content).toBe('hello');
});

test('rejects weak passwords and invalid emails', async () => {
  const base = baseUrl();
  let res = await fetch(`${base}/register`, {
    method: 'POST', headers: JSON_HEADERS,
    body: JSON.stringify({ username: 'bob', password: 'short', email: 'bob@example.com' })
  });
  expect(res.status).toBe(400);

  res = await fetch(`${base}/register`, {
    method: 'POST', headers: JSON_HEADERS,
    body: JSON.stringify({ username: 'bob', password: 'password123', email: 'not-an-email' })
  });
  expect(res.status).toBe(400);
});

test('rejects login with a wrong password', async () => {
  const base = baseUrl();
  await register('carol');
  const res = await fetch(`${base}/login`, {
    method: 'POST', headers: JSON_HEADERS,
    body: JSON.stringify({ username: 'carol', password: 'wrongpassword' })
  });
  expect(res.status).toBe(401);
});

test('stored password uses the scrypt scheme', () => {
  const db = require('../db');
  const user = db.getUserByUsername('carol');
  expect(user).toBeTruthy();
  expect(user.password_hash.startsWith('scrypt$')).toBe(true);
});

test('realtime messages carry ids; REST backfills after an id', async () => {
  const { token } = await register('dave');
  await createServer(token, 'rt');
  const gw = gateway(token);
  await gw.ready;
  gw.send({ op: 'message', space: 'rt', channel: 'general', content: 'first' });
  await wait(50);
  gw.send({ op: 'message', space: 'rt', channel: 'general', content: 'second' });
  await wait(80);
  gw.close();

  const msgs = gw.frames.filter((f) => f.type === 'message');
  expect(msgs.length).toBe(2);
  expect(typeof msgs[0].id).toBe('number');
  expect(typeof msgs[0].timestamp).toBe('number');
  const firstId = msgs[0].id;

  const backfill = await messages(token, 'rt', 'general', `?after=${firstId}`);
  const contents = backfill.map((m) => m.content);
  expect(contents).toContain('second');
  expect(contents).not.toContain('first');
});

test('admin management endpoints require authentication', async () => {
  const base = baseUrl();
  let res = await fetch(`${base}/admin/state`);
  expect(res.status).toBe(401);
  const login = await fetch(`${base}/login`, {
    method: 'POST', headers: JSON_HEADERS,
    body: JSON.stringify({ username: 'alice', password: 'password123' })
  });
  const { token } = await login.json();
  res = await fetch(`${base}/admin/state`, { headers: auth(token) });
  expect(res.status).toBe(200);
});

test('messages can be edited and deleted by their author', async () => {
  const { token } = await register('frank');
  await createServer(token, 'ed');
  const gw = gateway(token);
  await gw.ready;

  gw.send({ op: 'message', space: 'ed', channel: 'general', content: 'original text' });
  await wait(60);
  const msg = gw.frames.find((f) => f.type === 'message');
  expect(msg).toBeTruthy();

  gw.send({ op: 'edit', id: msg.id, content: 'edited text' });
  await wait(60);
  const update = gw.frames.find((f) => f.type === 'message_update');
  expect(update).toBeTruthy();
  expect(update.content).toBe('edited text');
  expect(typeof update.editedAt).toBe('number');

  gw.send({ op: 'delete', id: msg.id });
  await wait(60);
  const del = gw.frames.find((f) => f.type === 'message_delete');
  expect(del).toBeTruthy();
  gw.close();

  const msgs = await messages(token, 'ed', 'general');
  expect(msgs.find((m) => m.id === del.id)).toBeFalsy();
});

test('server membership is enforced and invites grant access', async () => {
  const base = baseUrl();
  const owner = (await register('grace')).token;
  expect((await createServer(owner, 'grace-hq')).status).toBe(201);
  const outsider = (await register('heidi')).token;

  // Outsider does not see the server in their list.
  let mine = await (await fetch(`${base}/spaces`, { headers: auth(outsider) })).json();
  expect(mine.find((s) => s.name === 'grace-hq')).toBeFalsy();

  // Outsider cannot read its messages.
  let res = await fetch(`${base}/spaces/grace-hq/channels/general/messages`, { headers: auth(outsider) });
  expect(res.status).toBe(403);

  // A gateway message op aimed at a server they don't belong to is ignored.
  const gw = gateway(outsider);
  await gw.ready;
  gw.send({ op: 'message', space: 'grace-hq', channel: 'general', content: 'intrusion' });
  await wait(80);
  gw.close();
  let msgs = await messages(owner, 'grace-hq', 'general');
  expect(msgs.find((m) => m.content === 'intrusion')).toBeFalsy();

  // Owner mints an invite; outsider joins with it.
  res = await fetch(`${base}/spaces/grace-hq/invites`, { method: 'POST', headers: auth(owner) });
  expect(res.status).toBe(201);
  const { code } = await res.json();

  res = await fetch(`${base}/invites/${code}`, { method: 'POST', headers: auth(outsider) });
  expect(res.status).toBe(200);

  mine = await (await fetch(`${base}/spaces`, { headers: auth(outsider) })).json();
  expect(mine.find((s) => s.name === 'grace-hq')).toBeTruthy();
  res = await fetch(`${base}/spaces/grace-hq/channels/general/messages`, { headers: auth(outsider) });
  expect(res.status).toBe(200);
});

test('reactions toggle, persist in history, and typing is relayed', async () => {
  const { token } = await register('ivy');
  await createServer(token, 'rx');
  const gw = gateway(token);
  await gw.ready;

  gw.send({ op: 'message', space: 'rx', channel: 'general', content: 'react to me' });
  await wait(60);
  const msg = gw.frames.find((f) => f.type === 'message');
  gw.send({ op: 'react', id: msg.id, emoji: '👍' });
  await wait(50);
  gw.send({ op: 'react', id: msg.id, emoji: '👍' });
  await wait(50);
  gw.send({ op: 'react', id: msg.id, emoji: '❤️' });
  await wait(60);
  gw.close();

  const reactions = gw.frames.filter((f) => f.type === 'reaction');
  expect(reactions[0]).toMatchObject({ emoji: '👍', count: 1 });
  expect(reactions[0].users).toContain('ivy');
  expect(reactions[1]).toMatchObject({ emoji: '👍', count: 0 });
  expect(reactions[2]).toMatchObject({ emoji: '❤️', count: 1 });

  const msgs = await messages(token, 'rx', 'general');
  const target = msgs.find((m) => m.reactions && m.reactions.length);
  expect(target.reactions.find((r) => r.emoji === '❤️').count).toBe(1);

  // Typing relays only to sockets focused on the channel (excluding the sender).
  const listener = gateway(token);
  await listener.ready;
  listener.send({ op: 'focus', space: 'rx', channel: 'general' });
  await wait(40);
  const sender = gateway(token);
  await sender.ready;
  sender.send({ op: 'typing', space: 'rx', channel: 'general' });
  await wait(100);
  const relayed = listener.frames.find((f) => f.type === 'typing' && f.user === 'ivy');
  listener.close();
  sender.close();
  expect(relayed).toBeTruthy();
});

test('unread counts track messages since last read', async () => {
  const base = baseUrl();
  const owner = (await register('nate')).token;
  await createServer(owner, 'un');
  const kev = (await register('kev')).token;

  const { code } = await (await fetch(`${base}/spaces/un/invites`, { method: 'POST', headers: auth(owner) })).json();
  await fetch(`${base}/invites/${code}`, { method: 'POST', headers: auth(kev) }); // clean slate on join

  // Owner posts a message after kev joined.
  const og = gateway(owner);
  await og.ready;
  og.send({ op: 'message', space: 'un', channel: 'general', content: 'ping' });
  await wait(80);
  const msg = og.frames.find((f) => f.type === 'message');
  og.close();
  expect(msg).toBeTruthy();

  // Kev connects: the unread snapshot shows 1 for un/general.
  const kg = gateway(kev);
  await kg.ready;
  await wait(60);
  let unread = kg.frames.find((f) => f.type === 'unread');
  expect(unread).toBeTruthy();
  let entry = unread.counts.find((c) => c.space === 'un' && c.channel === 'general');
  expect(entry && entry.count).toBe(1);

  // Kev marks it read, then reconnects: no unread remains.
  kg.send({ op: 'read', space: 'un', channel: 'general', lastId: msg.id });
  await wait(60);
  kg.close();

  const kg2 = gateway(kev);
  await kg2.ready;
  await wait(60);
  unread = kg2.frames.find((f) => f.type === 'unread');
  entry = (unread.counts || []).find((c) => c.space === 'un' && c.channel === 'general');
  expect(entry).toBeFalsy();
  kg2.close();
});

test('users can view and update their avatar via /me', async () => {
  const base = baseUrl();
  const { token } = await register('jane');

  let res = await fetch(`${base}/me`, { headers: auth(token) });
  expect(res.status).toBe(200);
  let me = await res.json();
  expect(me.username).toBe('jane');
  expect(me.avatar).toBeNull();

  res = await fetch(`${base}/me`, {
    method: 'PATCH',
    headers: { ...JSON_HEADERS, ...auth(token) },
    body: JSON.stringify({ avatar: 'http://evil.example/x.png' }),
  });
  expect(res.status).toBe(400);

  res = await fetch(`${base}/me`, {
    method: 'PATCH',
    headers: { ...JSON_HEADERS, ...auth(token) },
    body: JSON.stringify({ avatar: '/uploads/abc123/pic.png' }),
  });
  expect(res.status).toBe(200);
  me = await res.json();
  expect(me.avatar).toBe('/uploads/abc123/pic.png');
});

test('file uploads: auth required, no name collisions, type + size validation', async () => {
  const base = baseUrl();
  const { token } = await register('erin');
  const headers = auth(token);

  let res = await fetch(`${base}/uploads?name=photo.png`, { method: 'POST', body: 'AAA' });
  expect(res.status).toBe(401);

  res = await fetch(`${base}/uploads?name=photo.png`, { method: 'POST', headers, body: 'hello-image' });
  expect(res.status).toBe(201);
  const up1 = await res.json();
  expect(up1.url).toMatch(/^\/uploads\/[0-9a-f]+\/photo\.png$/);
  expect(up1.name).toBe('photo.png');
  expect(up1.type).toBe('image/png');
  expect(up1.inline).toBe(true);
  expect(up1.size).toBe('hello-image'.length);

  res = await fetch(`${base}/uploads?name=photo.png`, { method: 'POST', headers, body: 'other-bytes' });
  const up2 = await res.json();
  expect(up2.url).not.toBe(up1.url);

  res = await fetch(`${base}${up1.url}`);
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toBe('image/png');
  expect(await res.text()).toBe('hello-image');

  res = await fetch(`${base}/uploads?name=virus.exe`, { method: 'POST', headers, body: 'MZ' });
  expect(res.status).toBe(415);

  res = await fetch(`${base}/uploads?name=big.png`, { method: 'POST', headers, body: 'x'.repeat(1000) });
  expect(res.status).toBe(413);
});
