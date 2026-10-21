// P11-06: security headers on every response, a strict CSP on the app shell,
// and CORS only for origins listed in ALLOWED_ORIGINS (none by default).
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIST = fs.mkdtempSync(path.join(os.tmpdir(), 'dg-headers-'));
let serverModule;
let port;

beforeAll(async () => {
  fs.writeFileSync(path.join(DIST, 'index.html'), '<!doctype html><title>DisGourd</title>');
  fs.writeFileSync(path.join(DIST, 'app.js'), 'console.log(1)');
  process.env.WEB_DIST = DIST;
  process.env.PORT = 0;
  process.env.JWT_SECRET = 'disgourd-test-secret-0123456789abcdef';
  process.env.DB_PATH = ':memory:';
  process.env.UPLOADS_DIR = path.join(os.tmpdir(), `disgourd-test-uploads-headers-${process.pid}`);
  serverModule = require('../server');
  await new Promise((r) => serverModule.httpServer.listen(0, r));
  port = serverModule.httpServer.address().port;
});
afterAll((done) => {
  delete process.env.WEB_DIST;
  delete process.env.ALLOWED_ORIGINS;
  delete process.env.LINK_PREVIEW_IMAGES;
  fs.rmSync(DIST, { recursive: true, force: true });
  serverModule.httpServer.close(done);
});

const get = (p, headers = {}) => fetch(`http://localhost:${port}${p}`, { headers });
// fetch won't send a custom Host header; plain http.request will.
const http = require('http');
const rawGet = (p, headers) => new Promise((resolve, reject) => {
  http.get({ host: 'localhost', port, path: p, headers }, (res) => {
    res.resume();
    resolve({ status: res.statusCode, headers: { get: (k) => res.headers[k.toLowerCase()] ?? null } });
  }).on('error', reject);
});
const directives = (csp) => Object.fromEntries(csp.split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
  const [name, ...values] = d.split(/\s+/);
  return [name, values];
}));

test('the app shell carries a strict CSP and the framing, referrer and permissions headers', async () => {
  const res = await rawGet('/', { host: `chat.example.org:${port}` });
  expect(res.status).toBe(200);
  const csp = directives(res.headers.get('content-security-policy'));
  expect(csp['default-src']).toEqual(["'self'"]);
  expect(csp['script-src']).toEqual(["'self'"]); // no inline or eval
  expect(csp['style-src']).toEqual(["'self'", "'unsafe-inline'"]);
  expect(csp['img-src']).toEqual(["'self'", 'data:', 'blob:']);
  expect(csp['media-src']).toEqual(["'self'", 'blob:']);
  expect(csp['font-src']).toEqual(["'self'", 'data:']);
  expect(csp['connect-src']).toEqual(["'self'", `ws://chat.example.org:${port}`]); // the live socket
  expect(csp['worker-src']).toEqual(["'self'"]);
  expect(csp['manifest-src']).toEqual(["'self'"]);
  expect(csp['frame-ancestors']).toEqual(["'none'"]);
  expect(csp['base-uri']).toEqual(["'none'"]);
  expect(csp['form-action']).toEqual(["'self'"]);
  expect(csp['object-src']).toEqual(["'none'"]);
  expect(res.headers.get('x-frame-options')).toBe('DENY');
  expect(res.headers.get('referrer-policy')).toBe('same-origin');
  expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  expect(res.headers.get('permissions-policy')).toBe('camera=(self), microphone=(self), display-capture=(self), geolocation=(), payment=(), usb=()');
  // HSTS is the proxy's or Cloudflare's job (Node can't tell whether TLS is in front).
  expect(res.headers.get('strict-transport-security')).toBeNull();
});

test('behind TLS the socket is wss://, and the SPA fallback gets the same policy', async () => {
  const { proxyTrust } = require('../net/clientIp');
  proxyTrust.enabled = true; // loopback is a trusted proxy with TRUST_PROXY=1
  try {
    const res = await rawGet('/some/app/route', { host: 'chat.example.org', 'x-forwarded-proto': 'https' });
    expect(directives(res.headers.get('content-security-policy'))['connect-src']).toEqual(["'self'", 'wss://chat.example.org']);
  } finally {
    proxyTrust.enabled = false;
  }
});

test('LINK_PREVIEW_IMAGES=direct lets card images come from other sites', async () => {
  process.env.LINK_PREVIEW_IMAGES = 'direct';
  const res = await get('/');
  expect(directives(res.headers.get('content-security-policy'))['img-src']).toEqual(["'self'", 'data:', 'blob:', 'https:']);
  delete process.env.LINK_PREVIEW_IMAGES;
});

test('static files and API answers get nosniff and Referrer-Policy, but no page policy', async () => {
  const js = await get('/app.js');
  expect(js.headers.get('x-content-type-options')).toBe('nosniff');
  expect(js.headers.get('content-security-policy')).toBeNull();
  const api = await get('/auth-info');
  expect(api.headers.get('x-content-type-options')).toBe('nosniff');
  expect(api.headers.get('referrer-policy')).toBe('same-origin');
});

test('no CORS by default: a foreign Origin gets no Access-Control-Allow-Origin', async () => {
  const res = await get('/auth-info', { origin: 'https://evil.example' });
  expect(res.headers.get('access-control-allow-origin')).toBeNull();
  const pre = await fetch(`http://localhost:${port}/auth-info`, { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } });
  expect(pre.status).toBe(204);
  expect(pre.headers.get('access-control-allow-origin')).toBeNull();
});

test('ALLOWED_ORIGINS: a listed origin is echoed back (with Vary: Origin); others still get nothing', async () => {
  process.env.ALLOWED_ORIGINS = 'https://app.example.org, http://localhost:5173';
  const ok = await get('/auth-info', { origin: 'https://app.example.org' });
  expect(ok.headers.get('access-control-allow-origin')).toBe('https://app.example.org');
  expect(ok.headers.get('vary')).toMatch(/Origin/);
  const pre = await fetch(`http://localhost:${port}/me`, { method: 'OPTIONS', headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'PATCH' } });
  expect(pre.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
  expect(pre.headers.get('access-control-allow-headers')).toMatch(/Authorization/);
  const no = await get('/auth-info', { origin: 'https://evil.example' });
  expect(no.headers.get('access-control-allow-origin')).toBeNull();
  delete process.env.ALLOWED_ORIGINS;
});
