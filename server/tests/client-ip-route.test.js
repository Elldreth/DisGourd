// P11-05: GET /admin/client-ip tells a site admin which address the server
// sees for them, and how (for checking the tunnel from a phone).
const os = require('os');
const path = require('path');

let serverModule;
let port;
let admin;
let member;

beforeAll(async () => {
  process.env.PORT = 0;
  process.env.JWT_SECRET = 'disgourd-test-secret-0123456789abcdef';
  process.env.DB_PATH = ':memory:';
  process.env.UPLOADS_DIR = path.join(os.tmpdir(), `disgourd-test-uploads-clientip-${process.pid}`);
  serverModule = require('../server');
  await new Promise((r) => serverModule.httpServer.listen(0, r));
  port = serverModule.httpServer.address().port;
  const reg = async (username) => (await (await fetch(`http://localhost:${port}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'gourd-test-pass-1', email: `${username}@example.com` }),
  })).json()).token;
  admin = await reg('owner'); // the first account is the site admin
  member = await reg('mia');
});
afterAll((done) => {
  const { proxyTrust } = require('../net/clientIp');
  Object.assign(proxyTrust, { enabled: false, cidrs: [], header: '' });
  serverModule.httpServer.close(done);
});

const get = (token, headers = {}) => fetch(`http://localhost:${port}/admin/client-ip`, { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers } });

test('site admins only', async () => {
  expect((await get()).status).toBe(401);
  expect((await get(member)).status).toBe(403);
});

test('shows the socket address with trust off, and the Cloudflare header from a trusted proxy', async () => {
  const off = await (await get(admin, { 'cf-connecting-ip': '198.51.100.7' })).json();
  expect(off).toMatchObject({ via: 'socket', trusted: false, trustProxy: false });
  const { proxyTrust, parseCidrs } = require('../net/clientIp');
  Object.assign(proxyTrust, { enabled: true, cidrs: parseCidrs('127.0.0.0/8, ::1/128'), header: 'cf-connecting-ip' });
  const on = await (await get(admin, { 'cf-connecting-ip': '198.51.100.7' })).json();
  expect(on).toMatchObject({ ip: '198.51.100.7', via: 'cf-connecting-ip', trusted: true, trustProxy: true, clientIpHeader: 'cf-connecting-ip' });
});
