// P11-10: ComfyUI may live on the LAN, a tailnet or this machine, but never at
// a link-local or cloud-metadata address, by name, by DNS answer or by redirect.
const http = require('http');
const os = require('os');
const path = require('path');

let serverModule;
let comfy;
let port;
let token;
let redirector; // a fake ComfyUI that redirects to the metadata address
let redirectPort;

beforeAll(async () => {
  process.env.PORT = 0;
  process.env.JWT_SECRET = 'disgourd-test-secret-0123456789abcdef';
  process.env.DB_PATH = ':memory:';
  process.env.UPLOADS_DIR = path.join(os.tmpdir(), `disgourd-test-uploads-comfyguard-${process.pid}`);
  serverModule = require('../server');
  comfy = require('../imagine/engines/comfyui');
  await new Promise((r) => serverModule.httpServer.listen(0, r));
  port = serverModule.httpServer.address().port;
  redirector = http.createServer((req, res) => {
    res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' });
    res.end();
  });
  await new Promise((r) => redirector.listen(0, '127.0.0.1', r));
  redirectPort = redirector.address().port;
  const res = await fetch(`http://localhost:${port}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'password123', email: 'admin@example.com' }),
  });
  token = (await res.json()).token; // the first account is the site admin
});
afterAll(async () => {
  await new Promise((r) => redirector.close(r));
  await new Promise((r) => serverModule.httpServer.close(r));
});

const lookupTo = (address) => async () => [{ address, family: address.includes(':') ? 6 : 4 }];

describe('saving the address', () => {
  test.each([
    'http://169.254.169.254/',
    'http://169.254.170.2:8188',
    'http://0.0.0.0:8188',
    'http://[fe80::1]:8188',
    'http://[::ffff:169.254.169.254]/',
    'http://[fd00:ec2::254]/',
    'http://metadata.google.internal/',
    'http://METADATA/',
  ])('refused: %s', (url) => {
    expect(comfy.validateConfig({ url }).error).toMatch(/isn’t allowed for ComfyUI/);
  });

  test.each([
    'http://192.168.1.20:8188',
    'http://10.0.0.5:8188',
    'http://100.101.102.103:8188', // a tailnet address
    'http://127.0.0.1:8188',
    'http://comfy.lan:8188',
  ])('allowed: %s', (url) => {
    expect(comfy.validateConfig({ url }).error).toBeUndefined();
  });
});

test('a host name that resolves to the metadata address is refused when used (no request is made)', async () => {
  comfy._setLookup(lookupTo('169.254.169.254'));
  await expect(comfy.listAll('http://sneaky.example:8188')).rejects.toMatchObject({ code: 'REFUSED' });
  comfy._setLookup(lookupTo('fe80::1'));
  await expect(comfy.listAll('http://sneaky6.example:8188')).rejects.toMatchObject({ code: 'REFUSED' });
});

test('a ComfyUI that redirects to the metadata address fails cleanly', async () => {
  comfy._setLookup(lookupTo('127.0.0.1'));
  await expect(comfy.listAll(`http://127.0.0.1:${redirectPort}`)).rejects.toMatchObject({ code: 'REFUSED' });
});

test('the admin test endpoint answers 400 with the reason', async () => {
  const res = await fetch(`http://localhost:${port}/admin/imagine/comfyui/test`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ url: 'http://169.254.169.254/' }),
  });
  expect(res.status).toBe(400);
  expect((await res.json()).error).toMatch(/isn’t allowed for ComfyUI/);
});
