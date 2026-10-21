// P3-27: edit history — old texts kept with when they were written, same-text
// edits saving nothing, the versions routes (channels, threads, DMs) and who
// may read them, and versions going with their message.
const WebSocket = require('ws');
const os = require('os');
const path = require('path');

let serverModule;
let port;
const SPACE = 'Draftland';

beforeAll((done) => {
  process.env.PORT = 0;
  process.env.JWT_SECRET = 'disgourd-test-secret-0123456789abcdef';
  process.env.DB_PATH = ':memory:';
  process.env.UPLOADS_DIR = path.join(os.tmpdir(), `disgourd-test-uploads-edits-${process.pid}`);
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
  const ready = new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });
  return { ready, send: (o) => ws.send(JSON.stringify(o)), close: () => ws.close() };
}

const call = async (who, p) => {
  const res = await fetch(`http://localhost:${port}${p}`, { headers: { Authorization: `Bearer ${users[who].token}` } });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const versions = (who, channel, id) => call(who, `/spaces/${SPACE}/channels/${encodeURIComponent(channel)}/messages/${id}/versions`);
const edit = async (who, id, content, op = 'edit') => {
  users[who].gw.send({ op, id, content });
  await wait(120);
};

beforeAll(async () => {
  const { db } = serverModule;
  for (const name of ['owner', 'bob', 'cara', 'outsider']) {
    const token = await register(name);
    users[name] = { token, id: db.getUserByUsername(name).id };
  }
  const id = db.createSpaceWithDefaults(SPACE, users.owner.id);
  db.addMember(id, users.bob.id, 'member');
  db.addMember(id, users.cara.id, 'member');
  db.createChannel(SPACE, 'staff');
  db.setChannelPerms(SPACE, 'staff', 3, 3); // owner only
  for (const name of ['owner', 'bob', 'cara']) {
    users[name].gw = gateway(users[name].token);
    await users[name].gw.ready;
  }
  await wait(100);
});

test('each edit keeps the previous text with when it was written; anyone in the channel can read them', async () => {
  const { db } = serverModule;
  const id = db.storeMessage(SPACE, 'general', 'first draft', users.bob.id).id;
  const createdAt = db.raw.prepare('SELECT created_at AS t FROM messages WHERE id = ?').get(id).t;
  await edit('bob', id, 'second draft');
  const firstEdit = db.raw.prepare('SELECT edited_at AS t FROM messages WHERE id = ?').get(id).t;
  await wait(5);
  await edit('bob', id, 'final text');
  const { status, body } = await versions('cara', 'general', id);
  expect(status).toBe(200);
  expect(body.versions).toEqual([
    { content: 'first draft', writtenAt: createdAt },
    { content: 'second draft', writtenAt: firstEdit },
  ]);
  expect(body.current.content).toBe('final text');
  expect(body.current.editedAt).toBeGreaterThanOrEqual(firstEdit);
});

test('an edit to the same text saves no version; a never-edited message has none', async () => {
  const { db } = serverModule;
  const id = db.storeMessage(SPACE, 'general', 'steady', users.bob.id).id;
  expect((await versions('owner', 'general', id)).body).toEqual({ versions: [], current: { content: 'steady', editedAt: null } });
  await edit('bob', id, 'steady');
  expect((await versions('owner', 'general', id)).body.versions).toEqual([]);
});

test("only the author's edits count; others' edit attempts save nothing", async () => {
  const { db } = serverModule;
  const id = db.storeMessage(SPACE, 'general', "bob's words", users.bob.id).id;
  await edit('cara', id, 'cara rewrote it');
  const body = (await versions('owner', 'general', id)).body;
  expect(body.versions).toEqual([]);
  expect(body.current.content).toBe("bob's words");
});

test('people who cannot see the channel get 404, as do wrong channels and unknown ids', async () => {
  const { db } = serverModule;
  const id = db.storeMessage(SPACE, 'staff', 'secret plan', users.owner.id).id;
  await edit('owner', id, 'secret plan v2');
  expect((await versions('owner', 'staff', id)).body.versions).toHaveLength(1);
  expect((await versions('bob', 'staff', id)).status).toBe(404);
  expect((await versions('outsider', 'staff', id)).status).toBe(403); // not a member of the server
  expect((await versions('owner', 'general', id)).status).toBe(404); // not in that channel
  expect((await versions('owner', 'general', 999999)).status).toBe(404);
});

test('thread messages have history too', async () => {
  const { db } = serverModule;
  const root = db.storeMessage(SPACE, 'general', 'root', users.owner.id).id;
  const thread = db.createThread(SPACE, 'general', root, 'side', users.owner.id).thread.channel;
  const id = db.storeMessage(SPACE, thread, 'in thread', users.bob.id).id;
  await edit('bob', id, 'in thread, edited');
  expect((await versions('cara', thread, id)).body.versions.map((v) => v.content)).toEqual(['in thread']);
});

test('deleting a message removes its versions', async () => {
  const { db } = serverModule;
  const id = db.storeMessage(SPACE, 'general', 'v1', users.bob.id).id;
  await edit('bob', id, 'v2');
  const count = () => db.raw.prepare('SELECT COUNT(*) AS n FROM message_versions WHERE message_id = ?').get(id).n;
  expect(count()).toBe(1);
  users.bob.gw.send({ op: 'delete', id });
  await wait(120);
  expect(count()).toBe(0);
});

test('DMs: both people can read the history; nobody else can', async () => {
  const { db } = serverModule;
  const dm = db.storeDm(users.bob.id, users.cara.id, 'hey cara');
  const id = dm.id;
  await edit('bob', id, 'hey cara!', 'dm_edit');
  await edit('bob', id, 'hey cara!!', 'dm_edit');
  const forBob = await call('bob', `/dms/cara/messages/${id}/versions`);
  expect(forBob.status).toBe(200);
  expect(forBob.body.versions.map((v) => v.content)).toEqual(['hey cara', 'hey cara!']);
  expect(forBob.body.current.content).toBe('hey cara!!');
  expect((await call('cara', `/dms/bob/messages/${id}/versions`)).body.versions).toHaveLength(2);
  expect((await call('outsider', `/dms/bob/messages/${id}/versions`)).status).toBe(404);
  expect((await call('owner', `/dms/cara/messages/${id}/versions`)).status).toBe(404);
  // Deleting the DM removes its versions.
  users.bob.gw.send({ op: 'dm_delete', id });
  await wait(120);
  expect(db.raw.prepare('SELECT COUNT(*) AS n FROM dm_message_versions WHERE message_id = ?').get(id).n).toBe(0);
});
