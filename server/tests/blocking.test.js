// P9-07a: blocking. While either of two people has blocked the other: no DMs
// (the old 1-to-1 stays readable), no adding each other to groups, no friend
// requests; the blocker gets no mentions, pushes or typing from the blocked
// person. The refusal is the same for both sides. Unblocking undoes it.
const WebSocket = require('ws');
const os = require('os');
const path = require('path');

jest.mock('web-push', () => ({
  generateVAPIDKeys: () => ({ publicKey: 'BPUBLICKEYPUBLICKEYPUBLICKEY', privateKey: 'private' }),
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn(async () => ({ statusCode: 201 })),
}));
const webpush = require('web-push');

let serverModule;
let db;
let port;
const users = {};
const gws = {};
const SPACE = 'Block Town';

beforeAll((done) => {
  process.env.PORT = 0;
  process.env.JWT_SECRET = 'disgourd-test-secret-0123456789abcdef';
  process.env.DB_PATH = ':memory:';
  process.env.UPLOADS_DIR = path.join(os.tmpdir(), `disgourd-test-uploads-blocks-${process.pid}`);
  serverModule = require('../server');
  // P11-10: pushes check DNS before sending; answer with a public address, no network.
  require('../net/pushHosts').setLookup(async () => [{ address: '142.250.0.1', family: 4 }]);
  db = serverModule.db;
  serverModule.httpServer.listen(0, () => {
    port = serverModule.httpServer.address().port;
    done();
  });
});
afterAll((done) => {
  for (const g of Object.values(gws)) g.close();
  serverModule.httpServer.closeAllConnections?.();
  serverModule.httpServer.close(done);
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const call = async (who, method, p, body) => {
  const res = await fetch(`http://localhost:${port}${p}`, {
    method, headers: { 'content-type': 'application/json', Authorization: `Bearer ${users[who].token}` }, body: body && JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
async function register(username) {
  const res = await fetch(`http://localhost:${port}/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'password123', email: `${username}@example.com` }),
  });
  users[username] = { token: (await res.json()).token, id: db.getUserByUsername(username).id };
}
function connect(name, who = name) {
  const ws = new WebSocket(`ws://localhost:${port}/gateway?token=${users[who].token}`);
  const frames = [];
  ws.on('message', (raw) => frames.push(JSON.parse(raw.toString())));
  gws[name] = { frames, send: (f) => ws.send(JSON.stringify(f)), close: () => ws.close(), of: (t) => frames.filter((f) => f.type === t) };
  return new Promise((r) => ws.on('open', r));
}
const pushedTo = () => webpush.sendNotification.mock.calls.map(([s]) => s.endpoint);
const subscribe = (who) => call(who, 'POST', '/push/subscriptions', { subscription: { endpoint: `https://fcm.googleapis.com/fcm/send/${who}`, keys: { p256dh: 'k', auth: 'a' } } });

beforeAll(async () => {
  for (const n of ['ann', 'ben', 'cyd']) await register(n);
  const space = db.createSpaceWithDefaults(SPACE, users.ann.id);
  db.addMember(space, users.ben.id, 'member');
  db.addMember(space, users.cyd.id, 'member');
  for (const n of ['ann', 'ben', 'cyd']) await connect(n);
  await connect('ann2', 'ann'); // ann's other tab
  // ann and ben already talk.
  gws.ann.send({ op: 'dm', to: 'ben', content: 'hi ben' });
  await wait(100);
});

test('block, list and unblock; my other tabs are told; myself and unknown people are refused', async () => {
  expect((await call('ann', 'PUT', '/blocks/ann')).status).toBe(400);
  expect((await call('ann', 'PUT', '/blocks/nobody')).status).toBe(404);
  expect(await call('ann', 'PUT', '/blocks/ben')).toEqual({ status: 200, body: { ok: true, blocked: true } });
  await wait(60);
  expect(gws.ann2.of('blocks_changed')).toHaveLength(1);
  expect(gws.ben.of('blocks_changed')).toHaveLength(0); // ben isn't told
  expect((await call('ann', 'GET', '/blocks')).body).toEqual([expect.objectContaining({ id: users.ben.id, username: 'ben', since: expect.any(Number) })]);
  expect((await call('ben', 'GET', '/blocks')).body).toEqual([]);
  expect(db.isBlocked(users.ann.id, users.ben.id)).toBe(true);
  expect(db.eitherBlocked(users.ben.id, users.ann.id)).toBe(true);
});

test('DMs stop both ways with the same words; the old 1-to-1 stays readable; GET /dms says so', async () => {
  const pair = db.findPair(users.ann.id, users.ben.id);
  gws.ben.send({ op: 'dm', to: 'ann', content: 'why?' });
  gws.ann.send({ op: 'dm', conversation: pair, content: 'bye' });
  await wait(120);
  const neutral = { type: 'error', op: 'dm', code: 'BLOCKED', error: "You can't message this person" };
  expect(gws.ben.of('error').at(-1)).toEqual(neutral);
  expect(gws.ann.of('error').at(-1)).toEqual(neutral);
  expect(db.getDmMessages(users.ann.id, users.ben.id).map((m) => m.content)).toEqual(['hi ben']);
  expect((await call('ben', 'GET', `/dms/c/${pair}/messages`)).body.map((m) => m.content)).toEqual(['hi ben']);
  expect((await call('ann', 'GET', '/dms')).body.find((c) => c.id === pair)).toMatchObject({ username: 'ben', blocked: true });
  expect((await call('ben', 'GET', '/dms')).body.find((c) => c.id === pair)).toMatchObject({ username: 'ann', blocked: true });
  // Typing doesn't reach ann either.
  gws.ann.send({ op: 'dm_focus', conversation: pair });
  await wait(40);
  gws.ben.send({ op: 'dm_typing', conversation: pair });
  await wait(60);
  expect(gws.ann.of('dm_typing')).toHaveLength(0);
  // Someone else's DMs are unaffected.
  gws.cyd.send({ op: 'dm', to: 'ann', content: 'hello ann' });
  await wait(80);
  expect(gws.ann.of('dm').at(-1)).toMatchObject({ from: 'cyd', content: 'hello ann' });
});

test('groups: neither adds the other; a third person can; in it, the blocker gets no pushes or typing from the blocked', async () => {
  gws.ann.send({ op: 'dm_group_create', members: ['ben', 'cyd'] });
  gws.ben.send({ op: 'dm_group_create', members: ['ann', 'cyd'] });
  await wait(120);
  expect(gws.ann.of('error').at(-1)).toEqual({ type: 'error', op: 'dm_group_create', code: 'BLOCKED', error: "You can't add ben" });
  expect(gws.ben.of('error').at(-1)).toEqual({ type: 'error', op: 'dm_group_create', code: 'BLOCKED', error: "You can't add ann" });
  gws.cyd.send({ op: 'dm_group_create', members: ['ann', 'ben'] });
  await wait(150);
  const group = gws.cyd.of('dm_group_created').at(-1).conversation;
  expect(db.participantIds(group)).toHaveLength(3);
  // ann can't add ben back after he leaves.
  gws.ben.send({ op: 'dm_group_leave', conversation: group });
  await wait(100);
  gws.ann.send({ op: 'dm_group_add', conversation: group, members: ['ben'] });
  await wait(100);
  expect(gws.ann.of('error').at(-1)).toMatchObject({ op: 'dm_group_add', code: 'BLOCKED' });
  gws.cyd.send({ op: 'dm_group_add', conversation: group, members: ['ben'] });
  await wait(100);
  expect(db.isParticipant(group, users.ben.id)).toBe(true);
  // Typing: cyd sees ben's, ann doesn't.
  gws.ann.send({ op: 'dm_focus', conversation: group });
  gws.cyd.send({ op: 'dm_focus', conversation: group });
  await wait(40);
  const annTyping = gws.ann.of('dm_typing').length;
  gws.ben.send({ op: 'dm_typing', conversation: group });
  await wait(60);
  expect(gws.cyd.of('dm_typing').at(-1)).toMatchObject({ from: 'ben', conversation: group });
  expect(gws.ann.of('dm_typing')).toHaveLength(annTyping);
  // Pushes: ann and cyd are away; ben's message pushes to cyd only.
  await subscribe('ann');
  await subscribe('cyd');
  gws.ann.close();
  gws.ann2.close();
  gws.cyd.close();
  await wait(100);
  webpush.sendNotification.mockClear();
  gws.ben.send({ op: 'dm', conversation: group, content: 'hello all' });
  await wait(150);
  expect(pushedTo()).toEqual(['https://fcm.googleapis.com/fcm/send/cyd']);
  await connect('ann');
  await connect('ann2', 'ann');
  await connect('cyd');
});

test('mentions: ben’s @ann gives ann no mention, badge or push; cyd still gets hers', async () => {
  gws.ann.close();
  gws.ann2.close();
  gws.cyd.close();
  await wait(100);
  webpush.sendNotification.mockClear();
  gws.ben.send({ op: 'message', space: SPACE, channel: 'general', content: '@ann and @cyd look' });
  await wait(150);
  const msg = db.raw.prepare("SELECT id FROM messages WHERE content = '@ann and @cyd look'").get();
  const mentioned = db.raw.prepare('SELECT user_id FROM mentions WHERE message_id = ?').all(msg.id).map((r) => r.user_id);
  expect(mentioned).toEqual([users.cyd.id]);
  expect(pushedTo()).toEqual(['https://fcm.googleapis.com/fcm/send/cyd']);
  // Friend requests: refused both ways, with the same words.
  for (const [from, to] of [['ben', 'ann'], ['ann', 'ben']]) {
    expect(await call(from, 'POST', '/friends/request', { username: to })).toEqual({ status: 403, body: { error: "You can't send this person a friend request" } });
  }
  await connect('ann');
  await connect('ann2', 'ann');
  await connect('cyd');
});

test('unblocking: DMs, mentions and friend requests work again', async () => {
  expect(await call('ann', 'DELETE', '/blocks/ben')).toEqual({ status: 200, body: { ok: true, blocked: false } });
  await wait(60);
  expect(gws.ann2.of('blocks_changed').length).toBeGreaterThanOrEqual(1);
  expect((await call('ann', 'GET', '/blocks')).body).toEqual([]);
  gws.ben.send({ op: 'dm', to: 'ann', content: 'friends again?' });
  await wait(100);
  expect(gws.ann.of('dm').at(-1)).toMatchObject({ from: 'ben', content: 'friends again?' });
  expect((await call('ann', 'GET', '/dms')).body.find((c) => c.username === 'ben').blocked).toBe(false);
  gws.ben.send({ op: 'message', space: SPACE, channel: 'general', content: 'ping @ann' });
  await wait(120);
  const msg = db.raw.prepare("SELECT id FROM messages WHERE content = 'ping @ann'").get();
  expect(db.raw.prepare('SELECT user_id FROM mentions WHERE message_id = ?').all(msg.id).map((r) => r.user_id)).toEqual([users.ann.id]);
  expect((await call('ben', 'POST', '/friends/request', { username: 'ann' })).status).toBe(201);
});
