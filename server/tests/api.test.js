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

test('register, login and store messages', async () => {
  const base = `http://localhost:${port}`;
  let res = await fetch(`${base}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'alice', password: 'password123', email: 'a@b.c' })
  });
  expect(res.status).toBe(201);

  res = await fetch(`${base}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'alice', password: 'password123' })
  });
  expect(res.status).toBe(200);
  const data = await res.json();
  const token = data.token;
  expect(token).toBeTruthy();

  await new Promise(resolve => {
    const ws = new WebSocket(`ws://localhost:${port}/ws/test/general?token=${token}`);
    ws.on('open', () => {
      ws.send(JSON.stringify({ content: 'hello' }));
      setTimeout(() => {
        ws.close();
        resolve();
      }, 50);
    });
  });

  res = await fetch(`${base}/spaces/test/channels/general/messages?limit=1`);
  const msgs = await res.json();
  expect(msgs.length).toBe(1);
  expect(msgs[0].content).toBe('hello');
});

test('rejects weak passwords and invalid emails', async () => {
  const base = `http://localhost:${port}`;
  let res = await fetch(`${base}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'bob', password: 'short', email: 'bob@example.com' })
  });
  expect(res.status).toBe(400);

  res = await fetch(`${base}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'bob', password: 'password123', email: 'not-an-email' })
  });
  expect(res.status).toBe(400);
});

test('rejects login with a wrong password', async () => {
  const base = `http://localhost:${port}`;
  await fetch(`${base}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'carol', password: 'password123', email: 'carol@example.com' })
  });
  const res = await fetch(`${base}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
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

test('realtime messages carry ids and support reconnect backfill', async () => {
  const base = `http://localhost:${port}`;
  const reg = await fetch(`${base}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'dave', password: 'password123', email: 'dave@example.com' })
  });
  const { token } = await reg.json();

  // Open a socket, run onOpen, and collect every frame for a short window.
  function openAndCollect(query, onOpen) {
    return new Promise((resolve) => {
      const got = [];
      const ws = new WebSocket(`ws://localhost:${port}/ws/rt/general?token=${token}${query}`);
      ws.on('message', (raw) => got.push(JSON.parse(raw.toString())));
      ws.on('open', () => { if (onOpen) onOpen(ws); });
      setTimeout(() => { ws.close(); resolve(got); }, 150);
    });
  }

  const sent = await openAndCollect('', (ws) => {
    ws.send(JSON.stringify({ content: 'first' }));
    setTimeout(() => ws.send(JSON.stringify({ content: 'second' })), 40);
  });
  const messages = sent.filter(m => m.type === 'message');
  expect(messages.length).toBe(2);
  expect(typeof messages[0].id).toBe('number');
  expect(typeof messages[0].timestamp).toBe('number');
  const firstId = messages[0].id;

  // A reconnecting client asking for everything after the first message should
  // receive only the second, delivered as a history (backfill) frame.
  const backfill = await openAndCollect(`&after=${firstId}`);
  const history = backfill.find(m => m.type === 'history');
  expect(history).toBeTruthy();
  const contents = history.messages.map(m => m.content);
  expect(contents).toContain('second');
  expect(contents).not.toContain('first');
});

test('admin management endpoints require authentication', async () => {
  const base = `http://localhost:${port}`;
  // No token -> rejected.
  let res = await fetch(`${base}/admin/state`);
  expect(res.status).toBe(401);
  // alice (registered earlier) has a valid token.
  const login = await fetch(`${base}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'alice', password: 'password123' })
  });
  const { token } = await login.json();
  res = await fetch(`${base}/admin/state`, { headers: { Authorization: `Bearer ${token}` } });
  expect(res.status).toBe(200);
});

test('messages can be edited and deleted by their author', async () => {
  const base = `http://localhost:${port}`;
  const reg = await fetch(`${base}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'frank', password: 'password123', email: 'frank@example.com' })
  });
  const { token } = await reg.json();

  const frames = await new Promise((resolve) => {
    const got = [];
    const ws = new WebSocket(`ws://localhost:${port}/ws/ed/general?token=${token}`);
    let editRequested = false;
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      got.push(m);
      if (m.type === 'message' && !editRequested) {
        editRequested = true;
        ws.send(JSON.stringify({ type: 'edit', id: m.id, content: 'edited text' }));
      } else if (m.type === 'message_update') {
        ws.send(JSON.stringify({ type: 'delete', id: m.id }));
      }
    });
    ws.on('open', () => ws.send(JSON.stringify({ content: 'original text' })));
    setTimeout(() => { ws.close(); resolve(got); }, 300);
  });

  const update = frames.find((f) => f.type === 'message_update');
  const del = frames.find((f) => f.type === 'message_delete');
  expect(update).toBeTruthy();
  expect(update.content).toBe('edited text');
  expect(typeof update.editedAt).toBe('number');
  expect(del).toBeTruthy();

  const res = await fetch(`${base}/spaces/ed/channels/general/messages?limit=50`);
  const msgs = await res.json();
  expect(msgs.find((m) => m.id === del.id)).toBeFalsy();
});

test('file uploads: auth required, no name collisions, type + size validation', async () => {
  const base = `http://localhost:${port}`;
  const reg = await fetch(`${base}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'erin', password: 'password123', email: 'erin@example.com' })
  });
  const { token } = await reg.json();
  const auth = { Authorization: `Bearer ${token}` };

  // Anonymous upload is rejected.
  let res = await fetch(`${base}/uploads?name=photo.png`, { method: 'POST', body: 'AAA' });
  expect(res.status).toBe(401);

  // Authenticated upload returns rich metadata.
  res = await fetch(`${base}/uploads?name=photo.png`, { method: 'POST', headers: auth, body: 'hello-image' });
  expect(res.status).toBe(201);
  const up1 = await res.json();
  expect(up1.url).toMatch(/^\/uploads\/[0-9a-f]+\/photo\.png$/);
  expect(up1.name).toBe('photo.png');
  expect(up1.type).toBe('image/png');
  expect(up1.inline).toBe(true);
  expect(up1.size).toBe('hello-image'.length);

  // A second file with the same name does not overwrite the first.
  res = await fetch(`${base}/uploads?name=photo.png`, { method: 'POST', headers: auth, body: 'other-bytes' });
  const up2 = await res.json();
  expect(up2.url).not.toBe(up1.url);

  // The first file is still downloadable with the correct content type.
  res = await fetch(`${base}${up1.url}`);
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toBe('image/png');
  expect(await res.text()).toBe('hello-image');

  // Executable types are blocked.
  res = await fetch(`${base}/uploads?name=virus.exe`, { method: 'POST', headers: auth, body: 'MZ' });
  expect(res.status).toBe(415);

  // Oversize uploads are rejected (limit set to 256 bytes for this suite).
  res = await fetch(`${base}/uploads?name=big.png`, { method: 'POST', headers: auth, body: 'x'.repeat(1000) });
  expect(res.status).toBe(413);
});
