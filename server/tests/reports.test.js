// P9-01: message reports — filing (viewers only, not your own or the bot's,
// one open report per person per message), the moderators-only queue and
// count, resolving / dismissing / deleting from the queue, and the log.
const WebSocket = require('ws');
const os = require('os');
const path = require('path');

let serverModule;
let port;
const SPACE = 'Reportland';

beforeAll((done) => {
  process.env.PORT = 0;
  process.env.JWT_SECRET = 'disgourd-test-secret-0123456789abcdef';
  process.env.DB_PATH = ':memory:';
  process.env.UPLOADS_DIR = path.join(os.tmpdir(), `disgourd-test-uploads-reports-${process.pid}`);
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
  const frames = [];
  ws.on('message', (raw) => frames.push(JSON.parse(raw.toString())));
  const ready = new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });
  return { frames, ready, close: () => ws.close() };
}

const call = async (who, method, p, body) => {
  const res = await fetch(`http://localhost:${port}${p}`, {
    method,
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${users[who].token}` },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const S = `/spaces/${SPACE}`;
const report = (who, channel, id, body = { reason: 'spam' }) => call(who, 'POST', `${S}/channels/${encodeURIComponent(channel)}/messages/${id}/report`, body);
const queue = (who, q = '') => call(who, 'GET', `${S}/reports${q}`);
const resolve = (who, id, body) => call(who, 'POST', `${S}/reports/${id}/resolve`, body);
const post = (who, content, channel = 'general') => serverModule.db.storeMessage(SPACE, channel, content, users[who].id).id;
const spaceId = () => serverModule.db.getSpaceByName(SPACE).id;
const last = (name, type) => [...users[name].gw.frames].reverse().find((f) => f.type === type);

beforeAll(async () => {
  const { db } = serverModule;
  for (const name of ['owner', 'admin', 'bob', 'cara', 'outsider']) {
    const token = await register(name);
    users[name] = { token, id: db.getUserByUsername(name).id };
  }
  const id = db.createSpaceWithDefaults(SPACE, users.owner.id);
  db.addMember(id, users.admin.id, 'admin');
  db.addMember(id, users.bob.id, 'member');
  db.addMember(id, users.cara.id, 'member');
  db.createChannel(SPACE, 'staff');
  db.setChannelPerms(SPACE, 'staff', 3, 3); // owner only
  for (const name of ['owner', 'admin', 'bob']) {
    users[name].gw = gateway(users[name].token);
    await users[name].gw.ready;
  }
  await wait(100);
});

test('filing: refusals for bad reasons, your own message, unseen channels and outsiders', async () => {
  const mine = post('bob', 'my own');
  expect((await report('bob', 'general', mine)).status).toBe(400);
  const theirs = post('cara', 'hello');
  expect((await report('bob', 'general', theirs, { reason: 'boring' })).status).toBe(400);
  expect((await report('bob', 'general', 999999)).status).toBe(404);
  expect((await report('bob', 'random', theirs)).status).toBe(404); // not in that channel
  const secret = post('owner', 'secret');
  expect((await report('bob', 'staff', secret)).status).toBe(404);
  expect((await report('outsider', 'general', theirs)).status).toBe(403);
});

test("a report reaches the moderators (count, frame, queue) but not members; the reporter is shown", async () => {
  const { db } = serverModule;
  const long = `buy gourds ${'x'.repeat(400)}`;
  const id = post('cara', long);
  const res = await report('bob', 'general', id, { reason: 'spam', note: '  third time today ' });
  expect(res.status).toBe(201);
  await wait(120);
  expect(last('admin', 'reports_changed')).toEqual({ type: 'reports_changed', space: SPACE, open: 1 });
  expect(last('bob', 'reports_changed')).toBeUndefined();
  const forAdmin = (await call('admin', 'GET', '/spaces')).body.find((s) => s.name === SPACE);
  expect(forAdmin.openReports).toBe(1);
  expect((await call('bob', 'GET', '/spaces')).body.find((s) => s.name === SPACE).openReports).toBeUndefined();
  expect((await queue('bob')).status).toBe(403);
  const { reports, more } = (await queue('admin')).body;
  expect(more).toBe(false);
  expect(reports[0]).toMatchObject({ messageId: id, channel: 'general', author: 'cara', reporter: 'bob', reason: 'spam', note: 'third time today', status: 'open', messageExists: true });
  expect(reports[0].excerpt.length).toBe(300);
  // A second report by the same person is a no-op.
  expect((await report('bob', 'general', id)).body).toEqual({ already: true });
  expect(db.countOpenReports(spaceId())).toBe(1);
});

test('dismissing closes every open report on that message and is logged', async () => {
  const { db } = serverModule;
  const id = post('cara', 'borderline joke');
  await report('bob', 'general', id, { reason: 'inappropriate' });
  await report('admin', 'general', id, { reason: 'other' });
  const open = (await queue('owner')).body.reports.filter((r) => r.messageId === id);
  expect(open).toHaveLength(2);
  // P10-01: the count is of messages, so two reports on one message count once.
  const all = (await queue('owner')).body.reports;
  expect(db.countOpenReports(spaceId())).toBe(new Set(all.map((r) => r.messageId)).size);
  expect(db.countOpenReports(spaceId())).toBeLessThan(all.length);
  const res = await resolve('owner', open[0].id, { action: 'dismiss' });
  expect(res.body).toEqual({ closed: 2 });
  expect((await queue('owner')).body.reports.some((r) => r.messageId === id)).toBe(false);
  const closed = (await queue('owner', '?status=closed')).body.reports.filter((r) => r.messageId === id);
  expect(closed.map((r) => r.status)).toEqual(['dismissed', 'dismissed']);
  expect(closed[0].resolvedBy).toBe('owner');
  expect(db.getModLog(spaceId(), { action: 'report_dismiss' }).entries[0]).toMatchObject({ actor: 'owner', target: 'cara', details: { reports: 2 } });
  expect((await resolve('owner', open[0].id, { action: 'dismiss' })).status).toBe(409);
});

test('deleting from the queue removes the message (viewers told), resolves, and logs both', async () => {
  const { db } = serverModule;
  const id = post('cara', 'really spammy');
  await report('bob', 'general', id);
  const r = (await queue('admin')).body.reports.find((x) => x.messageId === id);
  users.bob.gw.frames.length = 0;
  expect((await resolve('admin', r.id, { action: 'delete' })).status).toBe(200);
  await wait(120);
  expect(db.getMessageLocation(id)).toBeUndefined();
  expect(users.bob.gw.frames.some((f) => f.type === 'message_delete' && Number(f.id) === id)).toBe(true);
  const closed = (await queue('admin', '?status=closed')).body.reports.find((x) => x.id === r.id);
  expect(closed).toMatchObject({ status: 'resolved', resolution: 'deleted', messageExists: false, excerpt: 'really spammy' });
  expect(db.getModLog(spaceId(), { action: 'message_delete' }).entries[0]).toMatchObject({ actor: 'admin', target: 'cara' });
  expect(db.getModLog(spaceId(), { action: 'report_resolve' }).entries[0]).toMatchObject({ details: { resolution: 'deleted' } });
});

test('a moderator cannot delete a higher-ranked author’s message from the queue; resolved keeps a label', async () => {
  const id = post('owner', 'owner rant');
  await report('bob', 'general', id, { reason: 'harassment' });
  const r = (await queue('admin')).body.reports.find((x) => x.messageId === id);
  expect((await resolve('admin', r.id, { action: 'delete' })).status).toBe(403);
  expect(serverModule.db.getMessageLocation(id)).toBeTruthy();
  expect((await resolve('admin', r.id, { action: 'resolved', resolution: 'timeout' })).status).toBe(200);
  expect((await queue('admin', '?status=closed')).body.reports.find((x) => x.id === r.id)).toMatchObject({ status: 'resolved', resolution: 'timeout' });
});

test('a report outlives its message; thread reports say which thread; bot messages are refused', async () => {
  const { db } = serverModule;
  const id = post('cara', 'gone soon');
  await report('bob', 'general', id);
  db.deleteMessageById(id);
  const r = (await queue('admin')).body.reports.find((x) => x.excerpt === 'gone soon');
  expect(r).toMatchObject({ messageId: null, messageExists: false, author: 'cara' });
  await resolve('admin', r.id, { action: 'dismiss' });

  const root = post('owner', 'root');
  const thread = db.createThread(SPACE, 'general', root, 'side', users.owner.id).thread.channel;
  const inThread = post('cara', 'in a thread', thread);
  expect((await report('bob', thread, inThread)).status).toBe(201);
  const tr = (await queue('admin')).body.reports.find((x) => x.messageId === inThread);
  expect(tr.thread).toEqual({ name: 'side', parentChannel: 'general', channel: thread });

  const botId = db.ensureImagineBot();
  const botMsg = db.storeMessage(SPACE, 'general', 'imagined', botId).id;
  expect((await report('bob', 'general', botMsg)).status).toBe(400);
});

test('reports go when the server is deleted', async () => {
  const { db } = serverModule;
  const sid = spaceId();
  expect(db.countOpenReports(sid)).toBeGreaterThan(0);
  db.deleteSpace(SPACE);
  expect(db.raw.prepare('SELECT COUNT(*) AS n FROM reports WHERE space_id = ?').get(sid).n).toBe(0);
});
