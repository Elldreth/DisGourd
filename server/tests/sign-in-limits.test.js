// P11-08: sign-in can't be brute-forced from many addresses; IPv6 is limited
// per /64; the limiter can't grow without bound; easy passwords are refused.
const os = require('os');
const path = require('path');

let serverModule;
let rateLimit;
let port;
const PASS = 'gourd-test-pass-1';

beforeAll((done) => {
  process.env.PORT = 0;
  process.env.JWT_SECRET = 'disgourd-test-secret-0123456789abcdef';
  process.env.DB_PATH = ':memory:';
  process.env.UPLOADS_DIR = path.join(os.tmpdir(), `disgourd-test-uploads-signin-${process.pid}`);
  serverModule = require('../server');
  rateLimit = require('../auth/rateLimit');
  serverModule.httpServer.listen(0, () => {
    port = serverModule.httpServer.address().port;
    done();
  });
});
afterAll((done) => {
  serverModule.config.rateLimit = false;
  serverModule.config.trustProxy = false;
  serverModule.httpServer.close(done);
});

const base = () => `http://localhost:${port}`;
const post = (p, body, ip) =>
  fetch(`${base()}${p}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(ip ? { 'x-forwarded-for': ip } : {}) },
    body: JSON.stringify(body),
  });
const login = (username, password, ip) => post('/login', { username, password }, ip);

beforeAll(async () => {
  expect((await post('/register', { username: 'sandy', password: PASS, email: 'sandy@example.com' })).status).toBe(201);
  serverModule.config.rateLimit = true; // limits are off in other suites
  serverModule.config.trustProxy = true; // so each request can come "from" its own address
});

describe('per-account limit', () => {
  test('10 wrong passwords from 10 addresses lock the account for everyone, even with the right password', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    for (let i = 0; i < 10; i += 1) expect((await login('sandy', 'wrong-guess', `203.0.113.${i + 1}`)).status).toBe(401);
    const locked = await login('sandy', PASS, '198.51.100.7');
    expect(locked.status).toBe(429);
    expect((await locked.json()).error).toBe('Too many attempts. Please try again later.');
    expect(warn.mock.calls.some(([m]) => /10 failed sign-ins for sandy/.test(m))).toBe(true);
    warn.mockRestore();
  });

  test('after the window the right password works, and a success clears the count', async () => {
    rateLimit._expireAccountLocks(); // as if 15 minutes had passed
    expect((await login('sandy', PASS, '198.51.100.7')).status).toBe(200);
    for (let i = 0; i < 9; i += 1) await login('sandy', 'wrong-again', `203.0.113.${50 + i}`);
    expect((await login('sandy', PASS, '198.51.100.8')).status).toBe(200); // 9 failures: still fine
    for (let i = 0; i < 9; i += 1) await login('sandy', 'wrong-again', `203.0.113.${80 + i}`);
    expect((await login('sandy', PASS, '198.51.100.9')).status).toBe(200); // the success reset the count
  });

  test('unknown usernames are locked the same way (the answer never says whether one exists)', async () => {
    for (let i = 0; i < 10; i += 1) expect((await login('nobody-here', 'guess', `192.0.2.${i + 1}`)).status).toBe(401);
    expect((await login('nobody-here', 'guess', '192.0.2.200')).status).toBe(429);
  });

  test('the count ignores letter case', async () => {
    rateLimit._expireAccountLocks();
    for (let i = 0; i < 10; i += 1) await login(i % 2 ? 'SANDY' : 'Sandy', 'nope', `198.18.0.${i + 1}`);
    expect((await login('sandy', PASS, '198.18.1.1')).status).toBe(429);
    rateLimit._expireAccountLocks();
  });
});

describe('addresses', () => {
  test('IPv6 addresses in one /64 share a limit key; other /64s and IPv4 do not', () => {
    const k = rateLimit.addressKey;
    expect(k('2001:db8:1:2:aaaa::1')).toBe(k('2001:db8:1:2:ffff:ffff:ffff:ffff'));
    expect(k('2001:db8:1:2::5')).not.toBe(k('2001:db8:1:3::5'));
    expect(k('::ffff:203.0.113.9')).toBe('203.0.113.9');
    expect(k('203.0.113.9')).toBe('203.0.113.9');
    expect(k('unknown')).toBe('unknown');
  });

  test('15 failures from one /64 hit the per-address limit', async () => {
    rateLimit._expireAccountLocks();
    for (let i = 0; i < 15; i += 1) await login(`user${i}`, 'x-guess-x', `2001:db8:aa:bb::${i + 1}`);
    expect((await login('someone', 'x-guess-x', '2001:db8:aa:bb:ffff::9')).status).toBe(429);
    expect((await login('someone', 'x-guess-x', '2001:db8:aa:cc::9')).status).toBe(401); // another /64
  });
});

test('the limiter map stays under its cap, cheaply (no long event-loop stall)', () => {
  const started = Date.now();
  for (let i = 0; i < 100000; i += 1) rateLimit.rateLimitOk(`flood:${i}`, 5, 60000);
  expect(rateLimit._size()).toBeLessThanOrEqual(rateLimit.MAX_KEYS);
  // Trimming one key at a time made this take ~8 s, long enough for kept-alive
  // test sockets to be reset (CI run 39552647540). Amortised, it's well under 1 s.
  expect(Date.now() - started).toBeLessThan(1500);
  rateLimit._reset();
});

describe('easy passwords', () => {
  test.each(['password123', 'Password1', '12345678', 'qwertyuiop', 'aaaaaaaa', 'abcdefgh', 'iloveyou1', 'disgourd2024', 'walrus-walrus'])(
    'sign-up refuses %s',
    async (pw) => {
      rateLimit._reset();
      const res = await post('/register', { username: 'walrus', password: pw, email: 'w@example.com' }, '100.64.9.9');
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('That password is too easy to guess');
    }
  );

  test('a long random password is fine, and changing to an easy one is refused', async () => {
    rateLimit._reset();
    const res = await post('/register', { username: 'okpass', password: 'violet-otter-canyon-42', email: 'ok@example.com' }, '100.64.9.10');
    expect(res.status).toBe(201);
    const { token } = await res.json();
    const change = await fetch(`${base()}/me/password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ currentPassword: 'violet-otter-canyon-42', newPassword: 'letmein123' }),
    });
    expect(change.status).toBe(400);
    expect((await change.json()).error).toBe('That password is too easy to guess');
  });
});
