// P8: index.html's share-image link gets this server's own address, so other
// apps can fetch it; an odd Host header falls back to a relative link.
const fs = require('fs');
const os = require('os');
const path = require('path');

let serveWebApp;
let originFor;
let dir;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dg-share-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<meta property="og:image" content="__DG_ORIGIN__/og-image.png">');
  process.env.WEB_DIST = dir;
  ({ serveWebApp, originFor } = require('../static'));
});
afterAll(() => {
  delete process.env.WEB_DIST;
  fs.rmSync(dir, { recursive: true, force: true });
});

function fetchIndex(headers, encrypted = false) {
  return new Promise((resolve) => {
    const res = {
      writeHead: (status, h) => {
        res.status = status;
        res.headers = h;
      },
      end: (body) => resolve({ status: res.status, headers: res.headers, body: String(body) }),
    };
    serveWebApp('/', res, { headers, socket: { encrypted } });
  });
}

test('the share image link uses the Host the page was asked for', async () => {
  const r = await fetchIndex({ host: 'chat.example.org:3000' });
  expect(r.status).toBe(200);
  expect(r.body).toContain('content="http://chat.example.org:3000/og-image.png"');
  expect(r.body).not.toContain('__DG_ORIGIN__');
});

test('behind a proxy, X-Forwarded-Host and -Proto win', async () => {
  const r = await fetchIndex({ host: '127.0.0.1:3000', 'x-forwarded-host': 'gourd.example.net', 'x-forwarded-proto': 'https' });
  expect(r.body).toContain('content="https://gourd.example.net/og-image.png"');
});

test('a strange Host is never echoed into the page', async () => {
  const r = await fetchIndex({ host: 'evil.example"><script>alert(1)</script>' });
  expect(r.body).toContain('content="/og-image.png"');
  expect(r.body).not.toContain('script');
  expect(originFor({ headers: { host: '[::1]:3005' }, socket: {} })).toBe('http://[::1]:3005');
  expect(originFor({ headers: { host: 'a.b', 'x-forwarded-proto': 'gopher' }, socket: { encrypted: true } })).toBe('https://a.b');
  expect(originFor(undefined)).toBe('');
});
