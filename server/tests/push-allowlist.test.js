// P11-10: push subscriptions only for the real push services, never an
// address on the server's own network, at most 10 per person. The push
// service is mocked and DNS is faked, so nothing leaves the machine.
const os = require('os');
const path = require('path');

jest.mock('web-push', () => ({
  generateVAPIDKeys: () => ({ publicKey: 'BPUBLICKEYPUBLICKEYPUBLICKEY', privateKey: 'private' }),
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn(async () => ({ statusCode: 201 })),
}));
const webpush = require('web-push');

let serverModule;
let pushHosts;
let port;
const users = {};
const resolvesTo = {}; // host -> address the fake DNS answers with

beforeAll((done) => {
  process.env.PORT = 0;
  process.env.JWT_SECRET = 'disgourd-test-secret-0123456789abcdef';
  process.env.DB_PATH = ':memory:';
  process.env.UPLOADS_DIR = path.join(os.tmpdir(), `disgourd-test-uploads-pushallow-${process.pid}`);
  serverModule = require('../server');
  pushHosts = require('../net/pushHosts');
  pushHosts.setLookup(async (host) => [{ address: resolvesTo[host] || '142.250.0.1', family: 4 }]);
  serverModule.httpServer.listen(0, () => {
    port = serverModule.httpServer.address().port;
    done();
  });
});
afterAll((done) => {
  serverModule.httpServer.close(done);
});

const base = () => `http://localhost:${port}`;
const req = (who, method, p, body) =>
  fetch(`${base()}${p}`, { method, headers: { 'content-type': 'application/json', Authorization: `Bearer ${users[who].token}` }, body: body && JSON.stringify(body) });
const subscribe = (who, endpoint) => req(who, 'POST', '/push/subscriptions', { subscription: { endpoint, keys: { p256dh: 'k', auth: 'a' } } });

beforeAll(async () => {
  for (const name of ['ann', 'ben']) {
    const res = await fetch(`${base()}/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: name, password: 'password123', email: `${name}@example.com` }),
    });
    users[name] = { token: (await res.json()).token, id: serverModule.db.getUserByUsername(name).id };
  }
});
beforeEach(() => webpush.sendNotification.mockClear());

describe('which endpoints are allowed', () => {
  test.each([
    'https://192.168.1.1/push',
    'https://10.0.0.5/x',
    'https://audiobookshelf/x',
    'https://example.com/x',
    'https://fcm.googleapis.com.evil.example/x',
    'https://evilfcm.googleapis.com/x',
    'https://notify.windows.com.evil.example/x',
    'http://fcm.googleapis.com/fcm/send/abc',
    'https://fcm.googleapis.com:8443/fcm/send/abc',
    'https://user:pw@fcm.googleapis.com/fcm/send/abc',
    'https://[::1]/x',
    'not a url',
  ])('refused: %s', async (endpoint) => {
    expect(pushHosts.allowedPushEndpoint(endpoint)).toBe(false);
    const res = await subscribe('ann', endpoint);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/push service isn't supported|not a push subscription/);
  });

  test.each([
    'https://fcm.googleapis.com/fcm/send/abc123',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://updates-autopush.push.services.mozilla.com/wpush/v2/abc',
    'https://wns2-by3p.notify.windows.com/w/?token=abc',
    'https://web.push.apple.com/QAbc',
    'https://FCM.GoogleAPIs.com:443/fcm/send/upper',
  ])('accepted: %s', async (endpoint) => {
    expect(pushHosts.allowedPushEndpoint(endpoint)).toBe(true);
    expect((await subscribe('ben', endpoint)).status).toBe(201);
  });

  test('PUSH_HOSTS_EXTRA adds hosts (exact or *.suffix)', () => {
    const env = { PUSH_HOSTS_EXTRA: 'push.example.org, *.mypush.test' };
    expect(pushHosts.allowedPushEndpoint('https://push.example.org/x', env)).toBe(true);
    expect(pushHosts.allowedPushEndpoint('https://a.mypush.test/x', env)).toBe(true);
    expect(pushHosts.allowedPushEndpoint('https://mypush.test/x', env)).toBe(false);
    expect(pushHosts.allowedPushEndpoint('https://push.example.org/x')).toBe(false);
  });
});

test('at most 10 subscriptions per person: the 11th drops the oldest', async () => {
  const { db } = serverModule;
  db.raw.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(users.ben.id);
  for (let i = 1; i <= 11; i += 1) expect((await subscribe('ben', `https://fcm.googleapis.com/fcm/send/dev${i}`)).status).toBe(201);
  const endpoints = db.getPushSubscriptions(users.ben.id).map((s) => s.endpoint);
  expect(endpoints).toHaveLength(10);
  expect(endpoints).not.toContain('https://fcm.googleapis.com/fcm/send/dev1');
  expect(endpoints).toContain('https://fcm.googleapis.com/fcm/send/dev11');
});

test('an allowed host that resolves to a private address is not sent to', async () => {
  const { db } = serverModule;
  db.raw.prepare('DELETE FROM push_subscriptions').run();
  resolvesTo['web.push.apple.com'] = '192.168.1.1';
  pushHosts.setLookup(async (host) => [{ address: resolvesTo[host] || '142.250.0.1', family: 4 }]); // clears the cache
  expect((await subscribe('ben', 'https://web.push.apple.com/Qben')).status).toBe(201);
  expect((await subscribe('ben', 'https://fcm.googleapis.com/fcm/send/ben')).status).toBe(201);
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const sent = await require('../push').notifyIfAway(users.ben.id, { title: 't', body: 'b', data: {} });
  expect(sent).toBe(1);
  expect(webpush.sendNotification.mock.calls.map(([s]) => s.endpoint)).toEqual(['https://fcm.googleapis.com/fcm/send/ben']);
  expect(warn.mock.calls.some(([m]) => /web\.push\.apple\.com/.test(m))).toBe(true);
  warn.mockRestore();
  delete resolvesTo['web.push.apple.com'];
  pushHosts.setLookup(async (host) => [{ address: resolvesTo[host] || '142.250.0.1', family: 4 }]);
});

test('a DNS failure means no push (fail closed)', async () => {
  pushHosts.setLookup(async () => { throw new Error('ENOTFOUND'); });
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  expect(await require('../push').notifyIfAway(users.ben.id, { title: 't', body: 'b', data: {} })).toBe(0);
  expect(webpush.sendNotification).not.toHaveBeenCalled();
  warn.mockRestore();
  pushHosts.setLookup(async (host) => [{ address: resolvesTo[host] || '142.250.0.1', family: 4 }]);
});

test('rows saved before the allowlist are removed at start, and skipped if one slips through', async () => {
  const { db } = serverModule;
  db.raw.prepare('DELETE FROM push_subscriptions').run();
  const insert = db.raw.prepare('INSERT INTO push_subscriptions(user_id, endpoint, p256dh, auth, previews, created_at) VALUES (?, ?, ?, ?, 1, ?)');
  insert.run(users.ann.id, 'https://192.168.1.1/old', 'k', 'a', Date.now());
  insert.run(users.ann.id, 'https://fcm.googleapis.com/fcm/send/ann', 'k', 'a', Date.now());
  expect(pushHosts.pruneSubscriptions(db)).toBe(1);
  expect(db.getPushSubscriptions(users.ann.id).map((s) => s.endpoint)).toEqual(['https://fcm.googleapis.com/fcm/send/ann']);
  // One saved after start (e.g. by an older process) is skipped and dropped at send time.
  insert.run(users.ann.id, 'https://10.0.0.5/late', 'k', 'a', Date.now());
  expect(await require('../push').notifyIfAway(users.ann.id, { title: 't', body: 'b', data: {} })).toBe(1);
  expect(webpush.sendNotification.mock.calls.map(([s]) => s.endpoint)).toEqual(['https://fcm.googleapis.com/fcm/send/ann']);
  expect(db.getPushSubscriptions(users.ann.id).map((s) => s.endpoint)).toEqual(['https://fcm.googleapis.com/fcm/send/ann']);
});
