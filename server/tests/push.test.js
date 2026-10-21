// P2-18b: web push for @mentions and DMs, only when the person has no open
// socket and isn't in Do Not Disturb. The push service is mocked.
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
let port;
const users = {}; // name -> { token, id, gw? }
const SPACE = 'Pushville';

beforeAll((done) => {
  process.env.PORT = 0;
  process.env.JWT_SECRET = 'disgourd-test-secret-0123456789abcdef';
  process.env.DB_PATH = ':memory:';
  process.env.UPLOADS_DIR = path.join(os.tmpdir(), `disgourd-test-uploads-push-${process.pid}`);
  serverModule = require('../server');
  // P11-10: pushes check DNS before sending; answer with a public address, no network.
  require('../net/pushHosts').setLookup(async () => [{ address: '142.250.0.1', family: 4 }]);
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
const base = () => `http://localhost:${port}`;
const auth = (who) => ({ Authorization: `Bearer ${users[who].token}` });
const req = (who, method, p, body) =>
  fetch(`${base()}${p}`, { method, headers: { 'content-type': 'application/json', ...auth(who) }, body: body && JSON.stringify(body) });
const sub = (name) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${name}`, keys: { p256dh: 'p256dh-key', auth: 'auth-key' } });
const sent = () => webpush.sendNotification.mock.calls.map(([s, payload]) => ({ endpoint: s.endpoint, ...JSON.parse(payload) }));

async function register(username) {
  const res = await fetch(`${base()}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'password123', email: `${username}@example.com` }),
  });
  return (await res.json()).token;
}
function connect(who) {
  const u = users[who];
  u.gw = new WebSocket(`ws://localhost:${port}/gateway?token=${u.token}`);
  return new Promise((r) => u.gw.on('open', r));
}
const send = (who, frame) => users[who].gw.send(JSON.stringify(frame));

beforeAll(async () => {
  const { db } = serverModule;
  for (const name of ['ann', 'ben', 'cat']) {
    const token = await register(name);
    users[name] = { token, id: db.getUserByUsername(name).id };
  }
  const spaceId = db.createSpaceWithDefaults(SPACE, users.ann.id);
  db.addMember(spaceId, users.ben.id, 'member');
  db.addMember(spaceId, users.cat.id, 'member');
  await connect('ann'); // ann is the one talking; ben and cat are away
});

beforeEach(() => webpush.sendNotification.mockClear());

test('the public key is there for signed-in people; subscriptions are saved, updated and removed', async () => {
  expect((await fetch(`${base()}/push/vapid-key`)).status).toBe(401);
  expect(await (await fetch(`${base()}/push/vapid-key`, { headers: auth('ben') })).json()).toEqual({ key: 'BPUBLICKEYPUBLICKEYPUBLICKEY' });
  expect((await req('ben', 'POST', '/push/subscriptions', { subscription: { endpoint: 'http://not-https', keys: {} } })).status).toBe(400);
  expect((await req('ben', 'POST', '/push/subscriptions', { subscription: sub('ben-phone') })).status).toBe(201);
  expect((await req('ben', 'POST', '/push/subscriptions', { subscription: sub('ben-phone'), previews: false })).status).toBe(201); // updates in place
  expect((await req('cat', 'POST', '/push/subscriptions', { subscription: sub('cat-laptop'), previews: true })).status).toBe(201);
  const { db } = serverModule;
  expect(db.getPushSubscriptions(users.ben.id)).toEqual([expect.objectContaining({ endpoint: 'https://fcm.googleapis.com/fcm/send/ben-phone', previews: 0 })]);
  expect((await req('ben', 'DELETE', '/push/subscriptions', { endpoint: 'https://fcm.googleapis.com/fcm/send/nope' })).status).toBe(404);
  expect((await req('ben', 'DELETE', '/push/subscriptions', { endpoint: 'https://fcm.googleapis.com/fcm/send/ben-phone' })).status).toBe(200);
  expect(db.getPushSubscriptions(users.ben.id)).toEqual([]);
  // Back on, with previews (the default).
  await req('ben', 'POST', '/push/subscriptions', { subscription: sub('ben-phone') });
});

test('an @mention pushes to people who are away (with a preview), not to the sender', async () => {
  send('ann', { op: 'message', space: SPACE, channel: 'general', content: 'lunch? **@ben** and @cat come along ||secret||' });
  await wait(150);
  const got = sent();
  expect(got).toHaveLength(2);
  expect(got.find((p) => p.endpoint.endsWith('ben-phone'))).toMatchObject({
    title: `ann in #general · ${SPACE}`, body: 'lunch? @ben and @cat come along Spoiler', data: { space: SPACE, channel: 'general' },
  });
  expect(got.find((p) => p.endpoint.endsWith('cat-laptop'))).toBeTruthy();
});

test('no push while a socket is open, nor in Do Not Disturb, nor without a mention', async () => {
  await connect('ben');
  send('ann', { op: 'message', space: SPACE, channel: 'general', content: '@ben are you there' });
  await wait(120);
  expect(sent().filter((p) => p.endpoint.endsWith('ben-phone'))).toEqual([]);
  users.ben.gw.close();
  await wait(100);
  webpush.sendNotification.mockClear();
  serverModule.db.setUserPresence(users.cat.id, 'dnd');
  send('ann', { op: 'message', space: SPACE, channel: 'general', content: '@cat quiet time?' });
  await wait(120);
  expect(sent()).toEqual([]);
  serverModule.db.setUserPresence(users.cat.id, 'online');
  send('ann', { op: 'message', space: SPACE, channel: 'general', content: 'no mention here' });
  await wait(120);
  expect(sent()).toEqual([]);
});

test('previews off: the title and place, but no text', async () => {
  await req('cat', 'POST', '/push/subscriptions', { subscription: sub('cat-laptop'), previews: false });
  send('ann', { op: 'message', space: SPACE, channel: 'general', content: '@cat the password is hunter2' });
  await wait(150);
  const p = sent().find((x) => x.endpoint.endsWith('cat-laptop'));
  expect(p.title).toBe(`ann in #general · ${SPACE}`);
  expect(p.body).toBeUndefined();
  await req('cat', 'POST', '/push/subscriptions', { subscription: sub('cat-laptop'), previews: true });
});

test('a DM pushes with the sender as the title; a reply mentions its author', async () => {
  send('ann', { op: 'dm', to: 'ben', content: 'see you at 7' });
  await wait(150);
  expect(sent().find((p) => p.endpoint.endsWith('ben-phone'))).toMatchObject({ title: 'ann', body: 'see you at 7', data: { dm: 'ann' } });
  webpush.sendNotification.mockClear();
  const { db } = serverModule;
  const original = db.storeMessage(SPACE, 'general', 'original by cat', users.cat.id).id;
  send('ann', { op: 'message', space: SPACE, channel: 'general', content: 'replying', replyTo: original });
  await wait(150);
  expect(sent().find((p) => p.endpoint.endsWith('cat-laptop'))).toMatchObject({ title: `ann in #general · ${SPACE}`, body: 'replying' });
});

test('a dead subscription is dropped when the push service says 410', async () => {
  const { db } = serverModule;
  webpush.sendNotification.mockRejectedValueOnce(Object.assign(new Error('Gone'), { statusCode: 410 }));
  send('ann', { op: 'message', space: SPACE, channel: 'general', content: '@ben still there?' });
  await wait(150);
  expect(db.getPushSubscriptions(users.ben.id)).toEqual([]);
});
