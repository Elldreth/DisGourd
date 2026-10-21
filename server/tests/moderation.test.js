// P1-10: moderators delete other people's messages, within the rank hierarchy
// and the server's `delete_others_messages` threshold.
const WebSocket = require('ws');
const os = require('os');
const path = require('path');

let serverModule;
let port;

beforeAll((done) => {
  process.env.PORT = 0;
  process.env.JWT_SECRET = 'disgourd-test-secret-0123456789abcdef';
  process.env.DB_PATH = ':memory:';
  process.env.UPLOADS_DIR = path.join(os.tmpdir(), `disgourd-test-uploads-mod-${process.pid}`);
  serverModule = require('../server');
  serverModule.httpServer.listen(0, () => {
    port = serverModule.httpServer.address().port;
    done();
  });
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

const users = {}; // name -> { token, id, gw }

afterAll((done) => {
  // Close the test's gateway sockets first, or the server waits on them.
  for (const u of Object.values(users)) u.gw?.close();
  serverModule.httpServer.close(done);
});

beforeAll(async () => {
  const { db } = serverModule;
  for (const name of ['owner', 'admin', 'admin2', 'member', 'member2']) {
    const token = await register(name);
    users[name] = { token, id: db.getUserByUsername(name).id };
  }
  const spaceId = db.createSpaceWithDefaults('Modland', users.owner.id);
  for (const [name, role] of [['admin', 'admin'], ['admin2', 'admin'], ['member', 'member'], ['member2', 'member']]) {
    db.addMember(spaceId, users[name].id, role);
  }
  db.createChannel('Modland', 'owners-only');
  db.setChannelPerms('Modland', 'owners-only', 3, 3);
  for (const u of Object.values(users)) {
    u.gw = gateway(u.token);
    await u.gw.ready;
  }
  await wait(100);
});


function post(author, content, channel = 'general') {
  return serverModule.db.storeMessage('Modland', channel, content, users[author].id).id;
}

// Ask `actor` to delete message `id`; resolves whether it's gone.
async function tryDelete(actor, id) {
  users[actor].gw.send({ op: 'delete', id });
  await wait(120);
  return !serverModule.db.getMessageLocation(id);
}

test('an admin deletes a member\'s message, and viewers are told', async () => {
  const id = post('member', 'spam');
  expect(await tryDelete('admin', id)).toBe(true);
  const seen = users.member2.gw.frames.find((f) => f.type === 'message_delete' && Number(f.id) === Number(id));
  expect(seen).toBeTruthy();
});

test('a member cannot delete another member\'s message', async () => {
  const id = post('member2', 'mine');
  expect(await tryDelete('member', id)).toBe(false);
});

test('an admin cannot delete the owner\'s or another admin\'s message', async () => {
  expect(await tryDelete('admin', post('owner', 'boss'))).toBe(false);
  expect(await tryDelete('admin', post('admin2', 'peer'))).toBe(false);
});

test('the owner deletes an admin\'s message', async () => {
  expect(await tryDelete('owner', post('admin', 'oops'))).toBe(true);
});

test('authors still delete their own messages', async () => {
  expect(await tryDelete('member', post('member', 'typo'))).toBe(true);
});

test('raising the threshold to owner-only stops admins', async () => {
  const { db } = serverModule;
  const space = db.getSpaceByName('Modland');
  db.setSpacePermissions(space.id, { delete_others_messages: 3 });
  try {
    expect(await tryDelete('admin', post('member', 'still here'))).toBe(false);
    expect(await tryDelete('owner', post('member', 'gone'))).toBe(true);
  } finally {
    db.setSpacePermissions(space.id, { delete_others_messages: 2 });
  }
});

test('a moderator cannot delete in a channel they cannot view', async () => {
  // A member's old message in a channel that's now owners-only.
  const id = post('member', 'hidden', 'owners-only');
  expect(await tryDelete('admin', id)).toBe(false);
  expect(await tryDelete('owner', id)).toBe(true);
});

test('messages from people who left the server can be moderated', async () => {
  const { db } = serverModule;
  const id = post('member2', 'parting shot');
  db.removeMember(db.getSpaceByName('Modland').id, users.member2.id);
  try {
    expect(await tryDelete('admin', id)).toBe(true);
  } finally {
    db.addMember(db.getSpaceByName('Modland').id, users.member2.id, 'member');
  }
});
