const http = require('http');
const { safeFetch, isBlockedAddress } = require('../net/safeFetch');

// A local server whose behaviour each test picks by path.
let server;
let base;
const hits = [];
beforeAll((done) => {
  server = http.createServer((req, res) => {
    hits.push({ url: req.url, headers: req.headers });
    if (req.url === '/page') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('<html><head><title>Hello</title></head></html>');
    }
    if (req.url === '/hop') {
      res.writeHead(302, { Location: '/page' });
      return res.end();
    }
    if (req.url === '/to-metadata') {
      res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' });
      return res.end();
    }
    if (req.url === '/loop') {
      res.writeHead(302, { Location: '/loop' });
      return res.end();
    }
    if (req.url === '/big') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      const chunk = 'x'.repeat(16 * 1024);
      let sent = 0;
      const pump = () => {
        while (sent < 64 && res.write(chunk)) sent += 1;
        if (sent < 64) res.once('drain', pump);
        else res.end();
      };
      return pump();
    }
    if (req.url === '/big-declared') {
      res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Length': String(10 * 1024 * 1024) });
      return res.write('<html>'); // never finishes; the declared size alone is enough
    }
    if (req.url === '/slow') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.write('<html>');
      return; // never ends
    }
    if (req.url === '/image') {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      return res.end(Buffer.alloc(100));
    }
    if (req.url === '/missing') {
      res.writeHead(404, { 'Content-Type': 'text/html' });
      return res.end('<title>Not found</title>');
    }
    res.writeHead(500);
    res.end();
  });
  server.listen(0, '127.0.0.1', () => {
    base = `http://127.0.0.1:${server.address().port}`;
    done();
  });
});
afterAll((done) => {
  server.closeAllConnections?.();
  server.close(done);
});

const local = { allowLoopback: true };
// A fake resolver: `answers` is what DNS returns for any host.
const resolver = (...answers) => async () => answers.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));

async function expectCode(promise, code) {
  await expect(promise).rejects.toMatchObject({ code });
}

describe('address checks', () => {
  test.each([
    '127.0.0.1', '127.255.255.254', '10.0.0.1', '10.255.255.255', '172.16.0.1', '172.31.255.255',
    '192.168.1.1', '169.254.169.254', '100.64.0.1', '100.127.255.255', '0.0.0.0', '0.1.2.3',
    '224.0.0.1', '239.255.255.255', '240.0.0.1', '255.255.255.255', '192.0.2.1', '198.18.0.1',
    '::', '::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'febf::1', 'ff02::1',
    '::ffff:127.0.0.1', '::ffff:10.1.2.3', '::ffff:7f00:1', '64:ff9b::a9fe:a9fe', '64:ff9b::10.0.0.1',
    '2002:a00:1::', '2001:db8::1',
  ])('%s is blocked', (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  test.each(['93.184.216.34', '8.8.8.8', '172.32.0.1', '100.128.0.1', '192.169.0.1', '2606:4700::1111', '::ffff:8.8.8.8', '64:ff9b::808:808'])(
    '%s is allowed',
    (ip) => {
      expect(isBlockedAddress(ip)).toBe(false);
    }
  );

  test.each(['127.0.0.1', '10.0.0.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:192.168.0.1'])(
    'a host resolving to %s is refused before any request',
    async (ip) => {
      await expectCode(safeFetch('http://example.test/', { lookup: resolver(ip) }), 'BLOCKED_ADDRESS');
    }
  );

  test('one public and one private answer is refused', async () => {
    await expectCode(safeFetch('http://example.test/', { lookup: resolver('93.184.216.34', '10.0.0.5') }), 'BLOCKED_ADDRESS');
  });

  test('IP literals are checked too', async () => {
    await expectCode(safeFetch('http://169.254.169.254/latest/'), 'BLOCKED_ADDRESS');
    await expectCode(safeFetch('http://[::1]/'), 'BLOCKED_ADDRESS');
    await expectCode(safeFetch('http://2130706433/'), 'BLOCKED_ADDRESS'); // 127.0.0.1 as a number
  });

  test('loopback stays blocked without the test-only switch', async () => {
    await expectCode(safeFetch('http://127.0.0.1/page'), 'BLOCKED_ADDRESS');
    await expectCode(safeFetch('http://localhost/', { lookup: resolver('127.0.0.1') }), 'BLOCKED_ADDRESS');
    // The local test server's own (non-80/443) port is refused even earlier.
    await expectCode(safeFetch(`${base}/page`), 'BLOCKED_PORT');
  });
});

describe('URL checks', () => {
  test.each(['file:///etc/passwd', 'ftp://example.test/', 'gopher://example.test/', 'data:text/html,hi', 'javascript:alert(1)'])(
    '%s is refused',
    async (url) => {
      await expectCode(safeFetch(url), 'BLOCKED_PROTOCOL');
    }
  );

  test('port 8080 is refused', async () => {
    await expectCode(safeFetch('http://example.test:8080/', { lookup: resolver('93.184.216.34') }), 'BLOCKED_PORT');
  });

  test('credentials in the URL are refused', async () => {
    await expectCode(safeFetch('http://user:pass@example.test/', { lookup: resolver('93.184.216.34') }), 'CREDENTIALS');
  });

  test('a malformed URL is refused', async () => {
    await expectCode(safeFetch('not a url'), 'BAD_URL');
  });
});

describe('fetching (local test server)', () => {
  test('reads an HTML page, sends the bot User-Agent and nothing private', async () => {
    const res = await safeFetch(`${base}/page`, local);
    expect(res).toMatchObject({ status: 200, url: `${base}/page`, contentType: 'text/html' });
    expect(res.body).toContain('<title>Hello</title>');
    const h = hits.at(-1).headers;
    expect(h['user-agent']).toBe('DisGourdBot/1.0 (+link preview)');
    expect(h.cookie).toBeUndefined();
    expect(h.authorization).toBeUndefined();
  });

  test('follows a redirect and reports the final URL', async () => {
    const res = await safeFetch(`${base}/hop`, local);
    expect(res.url).toBe(`${base}/page`);
  });

  test('a redirect to the cloud metadata address is refused', async () => {
    await expectCode(safeFetch(`${base}/to-metadata`, local), 'BLOCKED_ADDRESS');
  });

  test('too many redirects are refused', async () => {
    await expectCode(safeFetch(`${base}/loop`, { ...local, maxRedirects: 3 }), 'TOO_MANY_REDIRECTS');
  });

  test('a body over the limit is cut off', async () => {
    await expectCode(safeFetch(`${base}/big`, { ...local, maxBytes: 64 * 1024 }), 'TOO_LARGE');
  });

  test('a declared size over the limit is refused without reading', async () => {
    await expectCode(safeFetch(`${base}/big-declared`, { ...local, maxBytes: 64 * 1024 }), 'TOO_LARGE');
  });

  test('a slow server times out', async () => {
    const started = Date.now();
    await expectCode(safeFetch(`${base}/slow`, { ...local, timeoutMs: 300 }), 'TIMEOUT');
    expect(Date.now() - started).toBeLessThan(2000);
  });

  test('a DNS lookup that never answers still times out', async () => {
    await expectCode(safeFetch('http://example.test/', { timeoutMs: 200, lookup: () => new Promise(() => {}) }), 'TIMEOUT');
  });

  test('a non-HTML response gives null', async () => {
    expect(await safeFetch(`${base}/image`, local)).toBeNull();
  });

  test('an error status gives null', async () => {
    expect(await safeFetch(`${base}/missing`, local)).toBeNull();
  });

  test('the test-only switch is ignored outside tests', async () => {
    const env = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await expectCode(safeFetch('http://localhost/', { ...local, lookup: resolver('127.0.0.1') }), 'BLOCKED_ADDRESS');
      await expectCode(safeFetch(`${base}/page`, local), 'BLOCKED_PORT');
    } finally {
      process.env.NODE_ENV = env;
    }
  });
});
