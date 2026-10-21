// P11-11: GET /voice/ice gives a signed-in client the ICE servers for calls.
// Plain STUN by default; short-lived TURN credentials from Cloudflare (owner
// decision 3) or from a coturn shared secret; relay-only when asked for.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

let serverModule;
let port;
let token;
let userId;
let ice;

const ENV_KEYS = ['STUN_URLS', 'TURN_URLS', 'TURN_SECRET', 'TURN_KEY_ID', 'TURN_KEY_TOKEN', 'TURN_KEY_TOKEN_FILE', 'VOICE_RELAY_ONLY'];
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dg-ice-'));

beforeAll(async () => {
  process.env.PORT = 0;
  process.env.JWT_SECRET = 'disgourd-test-secret-0123456789abcdef';
  process.env.DB_PATH = ':memory:';
  process.env.UPLOADS_DIR = path.join(os.tmpdir(), `disgourd-test-uploads-ice-${process.pid}`);
  serverModule = require('../server');
  ice = require('../voice/ice');
  await new Promise((r) => serverModule.httpServer.listen(0, r));
  port = serverModule.httpServer.address().port;
  const res = await fetch(`http://localhost:${port}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'caller', password: 'amber-lantern-orbit-58', email: 'caller@example.com' }),
  });
  token = (await res.json()).token;
  userId = serverModule.db.getUserByUsername('caller').id;
});
afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
  ice._reset();
});
afterAll((done) => {
  fs.rmSync(DIR, { recursive: true, force: true });
  serverModule.httpServer.close(done);
  serverModule.httpServer.closeAllConnections();
});

const get = (auth = true) => fetch(`http://localhost:${port}/voice/ice`, { headers: auth ? { Authorization: `Bearer ${token}` } : {} });

test('signed in only', async () => {
  expect((await get(false)).status).toBe(401);
});

test('with nothing set: STUN only, as before', async () => {
  const res = await get();
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }], relayOnly: false, expiresAt: null });
});

test('STUN_URLS replaces the default STUN', async () => {
  process.env.STUN_URLS = 'stun:stun.example.org:3478, stun:stun2.example.org';
  expect((await (await get()).json()).iceServers).toEqual([{ urls: ['stun:stun.example.org:3478', 'stun:stun2.example.org'] }]);
});

test('coturn: TURN_URLS + TURN_SECRET give a credential that checks out against the secret and expires later', async () => {
  process.env.TURN_URLS = 'turn:turn.example.org:3478?transport=udp,turns:turn.example.org:5349';
  process.env.TURN_SECRET = 'coturn-shared-secret';
  const before = Math.floor(Date.now() / 1000);
  const body = await (await get()).json();
  const turn = body.iceServers.find((s) => s.username);
  expect(turn.urls).toEqual(['turn:turn.example.org:3478?transport=udp', 'turns:turn.example.org:5349']);
  const [expiry, who] = turn.username.split(':');
  expect(Number(who)).toBe(userId);
  expect(Number(expiry)).toBeGreaterThan(before + 11 * 3600);
  expect(turn.credential).toBe(crypto.createHmac('sha1', 'coturn-shared-secret').update(turn.username).digest('base64'));
  expect(body.expiresAt).toBe(Number(expiry) * 1000);
  expect(body.relayOnly).toBe(false);
});

test('VOICE_RELAY_ONLY=1 asks for relay-only, but only when there is a relay to use', async () => {
  process.env.VOICE_RELAY_ONLY = '1';
  expect((await (await get()).json()).relayOnly).toBe(false); // STUN only: relay-only would break every call
  process.env.TURN_URLS = 'turn:turn.example.org:3478';
  process.env.TURN_SECRET = 'coturn-shared-secret';
  expect((await (await get()).json()).relayOnly).toBe(true);
});

describe('Cloudflare TURN', () => {
  const CF_SERVERS = [
    { urls: ['stun:stun.cloudflare.com:3478'] },
    { urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'], username: 'cf-user', credential: 'cf-cred' },
  ];
  const fakeFetch = (status = 201, body = { iceServers: CF_SERVERS }) => jest.fn(async () => ({ status, ok: status >= 200 && status < 300, json: async () => body }));

  test('asks Cloudflare with the key from TURN_KEY_TOKEN_FILE, and passes its servers on', async () => {
    const file = path.join(DIR, 'turn-key-token');
    fs.writeFileSync(file, 'cf-api-token\n');
    process.env.TURN_KEY_ID = 'key-123';
    process.env.TURN_KEY_TOKEN_FILE = file;
    const f = fakeFetch();
    ice._setFetch(f);
    const out = await ice.iceFor(userId);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://rtc.live.cloudflare.com/v1/turn/keys/key-123/credentials/generate-ice-servers');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer cf-api-token');
    expect(JSON.parse(init.body)).toEqual({ ttl: 12 * 3600 });
    expect(out.iceServers).toEqual(CF_SERVERS);
    expect(out.expiresAt).toBeGreaterThan(Date.now() + 11 * 3600 * 1000);
    // The same person again soon: no second request.
    await ice.iceFor(userId);
    expect(f).toHaveBeenCalledTimes(1);
  });

  test('if Cloudflare fails, calls still work with STUN, and it says so once', async () => {
    process.env.TURN_KEY_ID = 'key-123';
    process.env.TURN_KEY_TOKEN = 'cf-api-token';
    process.env.VOICE_RELAY_ONLY = '1';
    ice._setFetch(fakeFetch(401, { error: 'bad token' }));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const out = await ice.iceFor(userId);
      expect(out).toEqual({ iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }], relayOnly: false, expiresAt: null });
      await ice.iceFor(userId);
      expect(warn.mock.calls.filter(([m]) => /Cloudflare TURN/.test(m))).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });
});
