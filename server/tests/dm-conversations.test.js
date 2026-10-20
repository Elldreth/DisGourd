// P9-06a: DMs belong to conversations. The conversation-id paths and ops work
// alongside the old username ones; frames carry `conversation`; only people in
// a conversation can read it; unread is per conversation; orphan rules.
const WebSocket = require('ws');
const os = require('os');
const path = require('path');

let serverModule;
let db;
let port;

beforeAll((done) => {
  process.env.PORT = 0;
  process.env.JWT_SECRET = 'disgourd-test-secret-0123456789abcdef';
  process.env.DB_PATH = ':memory:';
  process.env.UPLOADS_DIR = path.join(os.tmpdir(), `disgourd-test-uploads-dmconv-${process.pid}`);
  serverModule = require('../server');
  db = serverModule.db;
  serverModule.httpServer.listen(0, () => {
    port = serverModule.httpServer.address().port;
    done();
  });
});
afterAll((done) => {
  serverModule.httpServer.closeAllConnections?.();
  serverModule.httpServer.close(done);
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tokens = {};
async function register(username) {
  const res = await fetch(`http://localhost:${port}/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'password123', email: `${username}@example.com` }),
  });
  tokens[username] = (await res.json()).token;
  return db.getUserByUsername(username).id;
}
const get = async (who, p) => {
  const res = await fetch(`http://localhost:${port}${p}`, { headers: { Authorization: `Bearer ${tokens[who]}` } });
  return { status: res.status, body: await res.json() };
};
function gateway(who) {
  const ws = new WebSocket(`ws://localhost:${port}/gateway?token=${tokens[who]}`);
  const frames = [];
  ws.on('message', (raw) => frames.push(JSON.parse(raw.toString())));
  const ready = new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });
  return { frames, ready, send: (obj) => ws.send(JSON.stringify(obj)), close: () => ws.close(), of: (type) => frames.filter((f) => f.type === type) };
}

test('pairs become conversations; ids and usernames both work; frames carry the conversation; strangers get 404', async () => {
  const alice = await register('alice');
  const bob = await register('bob');
  await register('cara');
  const ag = gateway('alice');
  const bg = gateway('bob');
  const cg = gateway('cara');
  await Promise.all([ag.ready, bg.ready, cg.ready]);
  try {
    // The first message (old style, by username) makes the pair.
    expect(db.findPair(alice, bob)).toBe(null);
    ag.send({ op: 'dm', to: 'bob', content: 'hi bob' });
    await wait(100);
    const conv = db.findPair(alice, bob);
    expect(conv).toBeGreaterThan(0);
    expect(db.getOrCreatePair(bob, alice)).toBe(conv); // one per pair, either way round
    expect(db.getConversation(conv)).toMatchObject({ kind: 'pair', name: null, ownerId: null });
    expect(db.participantIds(conv).sort()).toEqual([alice, bob].sort());
    const first = bg.of('dm').at(-1);
    expect(first).toMatchObject({ conversation: conv, from: 'alice', to: 'bob', toId: bob, content: 'hi bob' });
    expect(ag.of('dm').at(-1).conversation).toBe(conv);
    expect(cg.of('dm')).toHaveLength(0);

    // Bob answers by conversation id, replying to Alice.
    bg.send({ op: 'dm', conversation: conv, content: 'hi alice', replyTo: first.id });
    await wait(100);
    const second = ag.of('dm').at(-1);
    expect(second).toMatchObject({ conversation: conv, from: 'bob', to: 'alice', toId: alice, replyTo: { id: first.id, author: 'alice' } });
    // Cara can't post into it by id.
    cg.send({ op: 'dm', conversation: conv, content: 'let me in' });
    await wait(80);
    expect(ag.of('dm').at(-1).id).toBe(second.id);

    // GET /dms: the conversation, its members, and (for pairs) the other person.
    const list = (await get('alice', '/dms')).body;
    expect(list).toEqual([expect.objectContaining({
      id: conv, kind: 'pair', name: null, muted: false, username: 'bob', lastContent: 'hi alice', unread: 1,
      members: [expect.objectContaining({ id: alice, username: 'alice' }), expect.objectContaining({ id: bob, username: 'bob' })],
    })]);
    expect((await get('cara', '/dms')).body).toEqual([]);

    // History by id and by username are the same; Cara gets 404 by id.
    const byId = await get('alice', `/dms/c/${conv}/messages`);
    const byName = await get('alice', '/dms/bob/messages');
    expect(byId.status).toBe(200);
    expect(byId.body.map((m) => m.content)).toEqual(['hi bob', 'hi alice']);
    expect(byName.body).toEqual(byId.body);
    expect((await get('alice', `/dms/c/${conv}/messages?before=${second.id}`)).body.map((m) => m.id)).toEqual([first.id]);
    expect((await get('alice', `/dms/c/${conv}/messages?after=${first.id}`)).body.map((m) => m.id)).toEqual([second.id]);
    expect((await get('alice', `/dms/c/${conv}/messages?around=${first.id}`)).body.map((m) => m.id)).toEqual([first.id, second.id]);
    expect((await get('cara', `/dms/c/${conv}/messages`)).status).toBe(404);
    expect((await get('cara', '/dms/c/99999/messages')).status).toBe(404);
    expect((await get('cara', '/dms/alice/messages')).body).toEqual([]); // never talked: empty, as before

    // Unread per conversation (Bob's reply marked Alice's message read for him); read by id.
    expect(db.getDmUnreadCounts(alice)).toEqual([{ conversation: conv, count: 1, other: 'bob' }]);
    expect(db.getDmUnreadCounts(bob)).toEqual([]);
    const reconnect = gateway('alice');
    await reconnect.ready;
    await wait(80);
    reconnect.close();
    expect(reconnect.of('dm_unread').at(-1).counts).toEqual([{ conversation: conv, with: 'bob', count: 1 }]);
    ag.send({ op: 'dm_read', conversation: conv, lastId: second.id });
    await wait(60);
    expect(db.getDmUnreadCounts(alice)).toEqual([]);

    // Typing: to tabs looking at the conversation (by id, or by the old username).
    bg.send({ op: 'dm_focus', conversation: conv });
    cg.send({ op: 'dm_focus', conversation: conv }); // not hers: ignored
    await wait(40);
    ag.send({ op: 'dm_typing', conversation: conv });
    await wait(60);
    expect(bg.of('dm_typing').at(-1)).toEqual({ type: 'dm_typing', from: 'alice', conversation: conv });
    expect(cg.of('dm_typing')).toHaveLength(0);
    bg.send({ op: 'dm_focus', with: 'alice' });
    await wait(40);
    ag.send({ op: 'dm_typing', with: 'bob' });
    await wait(60);
    expect(bg.of('dm_typing')).toHaveLength(2);

    // Edit and delete reach both, with the conversation.
    ag.send({ op: 'dm_edit', id: first.id, content: 'hi bob!' });
    await wait(80);
    expect(bg.of('dm_update').at(-1)).toMatchObject({ id: first.id, conversation: conv, content: 'hi bob!' });
    expect((await get('bob', `/dms/c/${conv}/messages/${first.id}/versions`)).body).toMatchObject({ versions: [{ content: 'hi bob' }], current: { content: 'hi bob!' } });
    expect((await get('cara', `/dms/c/${conv}/messages/${first.id}/versions`)).status).toBe(404);
    ag.send({ op: 'dm_delete', id: first.id });
    await wait(80);
    expect(bg.of('dm_delete').at(-1)).toEqual({ type: 'dm_delete', id: first.id, conversation: conv });

    // Search names the conversation (and the other person, for pairs).
    const found = (await get('alice', '/search?q=alice')).body.dms;
    expect(found).toEqual([expect.objectContaining({ id: second.id, conversationId: conv, dmWith: 'bob' })]);
    expect((await get('cara', '/search?q=alice')).body.dms).toEqual([]);
  } finally {
    ag.close();
    bg.close();
    cg.close();
  }
});

test('orphans: someone gone leaves the conversation; it goes when nobody is left', async () => {
  const dee = await register('dee');
  const eve = await register('eve');
  db.storeDm(dee, eve, 'one');
  db.storeDm(eve, dee, 'two');
  const conv = db.findPair(dee, eve);
  const goneUser = (id) => {
    db.raw.pragma('foreign_keys = OFF'); // the way an orphan appears: a user removed without cascades
    db.raw.prepare('DELETE FROM users WHERE id = ?').run(id);
    db.raw.pragma('foreign_keys = ON');
    db.cleanupOrphans();
  };
  goneUser(eve);
  expect(db.participantIds(conv)).toEqual([dee]);
  expect(db.raw.prepare('SELECT COUNT(*) AS n FROM dm_messages WHERE conversation_id = ?').get(conv).n).toBe(2);
  expect(db.getDmConversations(dee)).toEqual([]); // a pair with nobody on the other side isn't listed
  goneUser(dee);
  expect(db.getConversation(conv)).toBe(null);
  expect(db.raw.prepare('SELECT COUNT(*) AS n FROM dm_messages WHERE conversation_id = ?').get(conv).n).toBe(0);
});
