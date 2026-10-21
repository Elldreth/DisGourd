// P9-06c: group DMs. Create (3–10 people; only people you share a server
// with or are friends with), add, remove (owner only), leave (ownership
// passes on; the last one out deletes it), rename, notices, fan-out to
// current members only, Mute (no pushes, unread still counts), GET /dms.
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
const users = {}; // name -> { token, id }
const gws = {};

beforeAll((done) => {
  process.env.PORT = 0;
  process.env.JWT_SECRET = 'disgourd-test-secret-0123456789abcdef';
  process.env.DB_PATH = ':memory:';
  process.env.UPLOADS_DIR = path.join(os.tmpdir(), `disgourd-test-uploads-groups-${process.pid}`);
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
const base = () => `http://localhost:${port}`;
const get = async (who, p) => {
  const res = await fetch(`${base()}${p}`, { headers: { Authorization: `Bearer ${users[who].token}` } });
  return { status: res.status, body: await res.json() };
};
async function register(username) {
  const res = await fetch(`${base()}/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'gourd-test-pass-1', email: `${username}@example.com` }),
  });
  users[username] = { token: (await res.json()).token, id: db.getUserByUsername(username).id };
}
function connect(who) {
  const ws = new WebSocket(`ws://localhost:${port}/gateway?token=${users[who].token}`);
  const frames = [];
  ws.on('message', (raw) => frames.push(JSON.parse(raw.toString())));
  gws[who] = { frames, send: (f) => ws.send(JSON.stringify(f)), close: () => ws.close(), of: (t) => frames.filter((f) => f.type === t) };
  return new Promise((r) => ws.on('open', r));
}
const said = (conv) => db.raw.prepare('SELECT content, kind FROM dm_messages WHERE conversation_id = ? ORDER BY id').all(conv);
const pushes = () => webpush.sendNotification.mock.calls.map(([s, payload]) => ({ endpoint: s.endpoint, ...JSON.parse(payload) }));

beforeAll(async () => {
  for (const name of ['ann', 'ben', 'cyd', 'dot', 'eve', 'fay', 'gus', 'hal', 'ivy', 'joe', 'kit', 'lou']) await register(name);
  // ann shares a server with everyone but eve and cyd; cyd is ann's friend; eve is a stranger.
  const space = db.createSpaceWithDefaults('Group Town', users.ann.id);
  for (const n of ['ben', 'dot', 'fay', 'gus', 'hal', 'ivy', 'joe', 'kit', 'lou']) db.addMember(space, users[n].id, 'member');
  db.addFriends(users.ann.id, users.cyd.id);
  for (const n of ['ann', 'ben', 'cyd', 'dot', 'eve']) await connect(n);
});

test('create: 3–10 people, only people you share a server with or friends; the owner; a notice; everyone gets the summary', async () => {
  const ann = gws.ann;
  ann.send({ op: 'dm_group_create', members: ['ben'] });
  ann.send({ op: 'dm_group_create', members: ['ben', 'eve'] });
  ann.send({ op: 'dm_group_create', members: ['ben', 'nobody'] });
  ann.send({ op: 'dm_group_create', members: ['ben', 'dot', 'fay', 'gus', 'hal', 'ivy', 'joe', 'kit', 'lou', 'cyd'] });
  await wait(120);
  expect(ann.of('error').map((e) => e.code)).toEqual(['BAD_REQUEST', 'NOT_ALLOWED', 'NOT_FOUND', 'TOO_MANY']);
  expect(ann.of('error')[1].error).toBe("You can't add eve"); // P11-09: the same neutral words as blocking

  ann.send({ op: 'dm_group_create', members: ['ben', 'cyd', 'ann'], name: '  Gourd   Club ' }); // cyd as a friend; yourself is ignored
  await wait(120);
  const conv = ann.of('dm_group_created').at(-1).conversation;
  expect(db.getConversation(conv)).toMatchObject({ kind: 'group', name: 'Gourd Club', ownerId: users.ann.id });
  expect(db.participantIds(conv)).toEqual([users.ann.id, users.ben.id, users.cyd.id]);
  expect(said(conv)).toEqual([{ content: 'ann started the group', kind: 'system' }]);
  for (const n of ['ann', 'ben', 'cyd']) {
    expect(gws[n].of('dm_conversation').at(-1).conversation).toMatchObject({
      id: conv, kind: 'group', name: 'Gourd Club', ownerId: users.ann.id, muted: false, members: [{ username: 'ann' }, { username: 'ben' }, { username: 'cyd' }].map(expect.objectContaining),
    });
    expect(gws[n].of('dm').at(-1)).toMatchObject({ kind: 'system', conversation: conv, from: 'ann', to: null, content: 'ann started the group' });
  }
  expect(gws.dot.of('dm_conversation')).toHaveLength(0);
  // GET /dms lists it from the start; history shows the notice with its kind.
  expect((await get('ben', '/dms')).body.find((c) => c.id === conv)).toMatchObject({ kind: 'group', name: 'Gourd Club', lastContent: 'ann started the group', lastAuthorId: users.ann.id, lastKind: 'system' });
  expect((await get('ben', `/dms/c/${conv}/messages`)).body).toEqual([expect.objectContaining({ content: 'ann started the group', kind: 'system', author: 'ann' })]);
  expect((await get('dot', `/dms/c/${conv}/messages`)).status).toBe(404);
});

test('messages, typing and edits reach current members only; notices can’t be edited, deleted or replied to; pushes name the group', async () => {
  const conv = db.getDmConversations(users.ann.id).find((c) => c.name === 'Gourd Club').id;
  await fetch(`${base()}/push/subscriptions`, { method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${users.lou.token}` }, body: JSON.stringify({ subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/lou', keys: { p256dh: 'k', auth: 'a' } } }) });
  gws.ann.send({ op: 'dm_group_add', conversation: conv, members: ['lou'] });
  await wait(120);
  webpush.sendNotification.mockClear();
  gws.ben.send({ op: 'dm_focus', conversation: conv });
  gws.ann.send({ op: 'dm', conversation: conv, content: 'hello group' });
  gws.ann.send({ op: 'dm_typing', conversation: conv });
  await wait(150);
  // P10-04: the list knows who said the last thing (a plain message, not a notice).
  expect(db.getDmConversations(users.ben.id).find((c) => c.id === conv)).toMatchObject({ lastContent: 'hello group', lastAuthorId: users.ann.id, lastKind: null });
  for (const n of ['ann', 'ben', 'cyd']) expect(gws[n].of('dm').at(-1)).toMatchObject({ conversation: conv, from: 'ann', content: 'hello group', to: null });
  expect(gws.dot.of('dm').filter((f) => f.conversation === conv)).toHaveLength(0);
  expect(gws.ben.of('dm_typing').at(-1)).toEqual({ type: 'dm_typing', from: 'ann', conversation: conv });
  // lou is away: a push titled with the group, body "ann: …".
  expect(pushes()).toEqual([expect.objectContaining({ endpoint: 'https://fcm.googleapis.com/fcm/send/lou', title: 'Gourd Club', body: 'ann: hello group', data: { dm: 'ann', conversation: conv } })]);
  // Notices: no edit, delete or reply.
  const noticeId = db.raw.prepare("SELECT id FROM dm_messages WHERE conversation_id = ? AND kind = 'system' ORDER BY id LIMIT 1").get(conv).id;
  gws.ann.send({ op: 'dm_edit', id: noticeId, content: 'hacked' });
  gws.ann.send({ op: 'dm_delete', id: noticeId });
  gws.ben.send({ op: 'dm', conversation: conv, content: 'a reply', replyTo: noticeId });
  await wait(120);
  expect(said(conv)[0]).toEqual({ content: 'ann started the group', kind: 'system' });
  expect(gws.ann.of('dm').at(-1)).toMatchObject({ content: 'a reply', replyTo: null });
  // An edit of a real message reaches the members.
  const hello = gws.ann.of('dm').find((f) => f.content === 'hello group').id;
  gws.ann.send({ op: 'dm_edit', id: hello, content: 'hello, group' });
  await wait(100);
  expect(gws.cyd.of('dm_update').at(-1)).toMatchObject({ id: hello, conversation: conv, content: 'hello, group' });
  expect(gws.dot.of('dm_update')).toHaveLength(0);
  // Search: members only.
  expect((await get('cyd', '/search?q=hello')).body.dms).toEqual([expect.objectContaining({ conversationId: conv, dmWith: null })]);
  expect((await get('dot', '/search?q=hello')).body.dms).toEqual([]);
});

test('add (anyone, up to 10, the rule), remove (owner only), leave (ownership passes), rename, mute, and the last one out', async () => {
  const conv = db.getDmConversations(users.ann.id).find((c) => c.name === 'Gourd Club').id; // ann, ben, cyd, lou
  // Anyone in it adds; the add rule is the adder's.
  gws.ben.send({ op: 'dm_group_add', conversation: conv, members: ['dot'] });
  await wait(150);
  expect(db.participantIds(conv)).toEqual(expect.arrayContaining([users.dot.id]));
  gws.ben.send({ op: 'dm_group_add', conversation: conv, members: ['eve'] }); // ben doesn't share a server with eve
  gws.eve.send({ op: 'dm_group_add', conversation: conv, members: ['eve'] }); // eve isn't in it
  await wait(100);
  expect(gws.ben.of('error').at(-1)).toMatchObject({ op: 'dm_group_add', code: 'NOT_ALLOWED' });
  expect(gws.eve.of('error').at(-1)).toMatchObject({ code: 'NOT_FOUND' });
  // Ten at most: one too many is refused whole; exactly ten is fine.
  const inNow = new Set(db.participantIds(conv));
  const free = ['fay', 'gus', 'hal', 'ivy', 'joe', 'kit'].filter((n) => !inNow.has(users[n].id));
  const room = 10 - inNow.size;
  gws.ann.send({ op: 'dm_group_add', conversation: conv, members: free.slice(0, room + 1) });
  await wait(100);
  expect(gws.ann.of('error').at(-1)).toMatchObject({ op: 'dm_group_add', code: 'TOO_MANY' });
  expect(db.participantIds(conv)).toHaveLength(inNow.size);
  gws.ann.send({ op: 'dm_group_add', conversation: conv, members: free.slice(0, room) });
  await wait(120);
  expect(db.participantIds(conv)).toHaveLength(10);
  expect(said(conv).at(-1).content).toMatch(/^ann added .+ and .+$/);
  // Only the owner removes; a removed member gets dm_left and loses access.
  gws.ben.send({ op: 'dm_group_remove', conversation: conv, member: 'dot' });
  await wait(80);
  expect(gws.ben.of('error').at(-1)).toMatchObject({ op: 'dm_group_remove', code: 'NOT_ALLOWED' });
  gws.ann.send({ op: 'dm_group_remove', conversation: conv, member: 'dot' });
  await wait(120);
  expect(gws.dot.of('dm_left').at(-1)).toEqual({ type: 'dm_left', conversation: conv, reason: 'removed', name: 'Gourd Club' });
  expect(db.isParticipant(conv, users.dot.id)).toBe(false);
  expect((await get('dot', `/dms/c/${conv}/messages`)).status).toBe(404);
  gws.ann.send({ op: 'dm', conversation: conv, content: 'after dot' });
  await wait(100);
  expect(gws.dot.of('dm').some((f) => f.content === 'after dot')).toBe(false);
  // Rename (anyone) and clear the name.
  gws.cyd.send({ op: 'dm_group_rename', conversation: conv, name: 'Squash Squad' });
  await wait(100);
  expect(db.getConversation(conv).name).toBe('Squash Squad');
  expect(gws.ann.of('dm_conversation').at(-1).conversation.name).toBe('Squash Squad');
  // Mute: per person; no push, unread still counts.
  db.setConversationMuted(conv, users.lou.id, true);
  webpush.sendNotification.mockClear();
  gws.ann.send({ op: 'dm', conversation: conv, content: 'quiet please' });
  await wait(120);
  expect(pushes()).toEqual([]);
  expect(db.getDmUnreadCounts(users.lou.id).find((c) => c.conversation === conv).count).toBeGreaterThan(0);
  gws.ben.send({ op: 'dm_mute', conversation: conv, muted: true });
  await wait(80);
  expect(gws.ben.of('dm_conversation').at(-1).conversation).toMatchObject({ id: conv, muted: true });
  expect(db.getConversationSummary(conv, users.ann.id).muted).toBe(false);
  // The owner leaves: the earliest-joined left takes over, with a notice.
  gws.ann.send({ op: 'dm_group_leave', conversation: conv });
  await wait(150);
  expect(gws.ann.of('dm_left').at(-1)).toMatchObject({ conversation: conv, reason: 'left' });
  expect(db.getConversation(conv).ownerId).toBe(users.ben.id);
  expect(said(conv).slice(-2).map((m) => m.content)).toEqual(['ann left', 'ben is now the owner']);
  // Pairs can't take group ops.
  gws.ben.send({ op: 'dm', to: 'lou', content: 'just us' }); // they share Group Town (P11-09)
  await wait(80);
  const pair = db.findPair(users.ben.id, users.lou.id);
  gws.ben.send({ op: 'dm_group_add', conversation: pair, members: ['dot'] });
  await wait(80);
  expect(gws.ben.of('error').at(-1)).toMatchObject({ op: 'dm_group_add', code: 'NOT_FOUND' });
  expect(db.participantIds(pair)).toHaveLength(2);
  // Everyone leaves: the group and its messages are gone.
  for (const id of db.participantIds(conv)) db.leaveConversation(conv, id);
  expect(db.getConversation(conv)).toBe(null);
  expect(said(conv)).toEqual([]);
});
