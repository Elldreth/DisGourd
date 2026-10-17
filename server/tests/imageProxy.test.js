// P2-23: link-preview images are served through the server (signed URLs), so
// the linked site never sees viewers' addresses.
const http = require('http');
const WebSocket = require('ws');
const os = require('os');
const fs = require('fs');
const path = require('path');

let serverModule;
let imageProxy;
let port;
let site;
let fixture;
const hits = [];
const uploads = path.join(os.tmpdir(), `disgourd-test-uploads-img-${process.pid}`);

// A tiny but real PNG (1×1).
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000001000000010806000000' +
    '1f15c4890000000d49444154789c6360f8cfc0f01f0005000201e5a5bc6e0000000049454e44ae426082',
  'hex'
);

beforeAll(async () => {
  process.env.PORT = 0;
  process.env.JWT_SECRET = 'disgourd-test-secret-0123456789abcdef';
  process.env.DB_PATH = ':memory:';
  process.env.UPLOADS_DIR = uploads;
  process.env.LINK_PREVIEWS_ALLOW_LOOPBACK = '1';
  serverModule = require('../server');
  imageProxy = require('../net/imageProxy');
  fixture = http.createServer((req, res) => {
    hits.push(req.url);
    const send = (type, body) => {
      res.writeHead(200, { 'Content-Type': type });
      res.end(body);
    };
    if (req.url === '/page') {
      return send('text/html', `<title>Pic page</title><meta property="og:image" content="/card.png">`);
    }
    if (req.url === '/card.png') return send('image/png', PNG);
    if (req.url === '/vector.svg') return send('image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    if (req.url === '/fake.png') return send('image/png', '<html><script>alert(1)</script></html>');
    if (req.url === '/huge.png') return send('image/png', Buffer.concat([PNG, Buffer.alloc(6 * 1024 * 1024)]));
    res.writeHead(404);
    res.end();
  });
  await new Promise((r) => fixture.listen(0, '127.0.0.1', r));
  site = `http://127.0.0.1:${fixture.address().port}`;
  await new Promise((r) => serverModule.httpServer.listen(0, r));
  port = serverModule.httpServer.address().port;
});

const base = () => `http://localhost:${port}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let token;
let gw;
const frames = [];

afterAll((done) => {
  gw?.close();
  fixture.close();
  fs.rmSync(uploads, { recursive: true, force: true });
  serverModule.httpServer.close(done);
});

beforeAll(async () => {
  const res = await fetch(`${base()}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'viewer', password: 'password123', email: 'viewer@example.com' }),
  });
  token = (await res.json()).token;
  const { db } = serverModule;
  db.createSpaceWithDefaults('Pics', db.getUserByUsername('viewer').id);
  gw = new WebSocket(`ws://localhost:${port}/gateway?token=${token}`);
  gw.on('message', (raw) => frames.push(JSON.parse(raw.toString())));
  await new Promise((r) => gw.on('open', r));
  await wait(50);
});

const get = (p) => fetch(`${base()}${p}`);

describe('signed proxy paths', () => {
  test('a path is signed for exactly one URL', () => {
    const p = imageProxy.proxyPath('https://cdn.example/a.png');
    expect(p).toMatch(/^\/media\/preview\/[\w-]{43}\/[\w-]+$/);
    const [, , , sig, enc] = p.split('/');
    expect(imageProxy.verify(sig, enc)).toBe('https://cdn.example/a.png');
    const other = imageProxy.proxyPath('https://cdn.example/b.png').split('/')[4];
    expect(imageProxy.verify(sig, other)).toBeNull(); // someone else's URL with this signature
    expect(imageProxy.verify(`${sig.slice(0, -1)}A`, enc)).toBeNull();
    expect(imageProxy.verify('nope', enc)).toBeNull();
  });

  test('non-http(s) images are never proxied', () => {
    expect(imageProxy.proxyPath('javascript:alert(1)')).toBeNull();
    expect(imageProxy.publicCard({ title: 't', image: 'data:image/png;base64,AA' }).image).toBeNull();
  });
});

describe('cards point at the proxy', () => {
  test('in the live frame and in history', async () => {
    gw.send(JSON.stringify({ op: 'message', space: 'Pics', channel: 'general', content: `${site}/page` }));
    await wait(80);
    await require('../linkPreviews').idle();
    await wait(80);
    const card = frames.filter((f) => f.type === 'message_embeds').at(-1).embeds[0];
    expect(card.title).toBe('Pic page');
    expect(card.image).toBe(imageProxy.proxyPath(`${site}/card.png`));
    const history = await (await fetch(`${base()}/spaces/Pics/channels/general/messages`, { headers: { Authorization: `Bearer ${token}` } })).json();
    expect(history.at(-1).embeds[0].image).toBe(card.image);
  });

  test('LINK_PREVIEW_IMAGES=direct keeps the original URL', () => {
    process.env.LINK_PREVIEW_IMAGES = 'direct';
    try {
      expect(imageProxy.publicCard({ title: 't', image: `${site}/card.png` }).image).toBe(`${site}/card.png`);
    } finally {
      delete process.env.LINK_PREVIEW_IMAGES;
    }
  });
});

describe('the proxy route', () => {
  test('serves the image with safe headers, then from its cache', async () => {
    const p = imageProxy.proxyPath(`${site}/card.png`);
    const before = hits.filter((h) => h === '/card.png').length;
    const res = await get(p);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'");
    expect(res.headers.get('cache-control')).toMatch(/max-age=86400/);
    expect(Buffer.from(await res.arrayBuffer()).equals(PNG)).toBe(true);
    const again = await get(p);
    expect(again.status).toBe(200);
    expect(hits.filter((h) => h === '/card.png').length).toBe(before + 1); // one upstream fetch for both
  });

  test('a tampered signature or URL is refused without fetching', async () => {
    const [, , , sig, enc] = imageProxy.proxyPath(`${site}/card.png?x=1`).split('/');
    const otherEnc = imageProxy.proxyPath(`${site}/vector.svg`).split('/')[4];
    const n = hits.length;
    expect((await get(`/media/preview/${sig}/${otherEnc}`)).status).toBe(404);
    expect((await get(`/media/preview/${'A'.repeat(43)}/${enc}`)).status).toBe(404);
    // (fetch normalises a literal ../ itself, so send it encoded the way an attacker would)
    expect((await get('/media/preview/..%2F..%2Fetc/passwd')).status).toBe(404);
    expect((await get(`/media/preview/${sig}/${enc}/extra`)).status).toBe(404);
    expect(hits.length).toBe(n);
  });

  test.each([
    ['an SVG', '/vector.svg'],
    ['HTML pretending to be a PNG', '/fake.png'],
    ['an image over the size cap', '/huge.png'],
  ])('%s is refused', async (_label, file) => {
    expect((await get(imageProxy.proxyPath(`${site}${file}`))).status).toBe(404);
  });

  test('a private address is refused with no request at all', async () => {
    const spy = jest.spyOn(http, 'request');
    try {
      expect((await get(imageProxy.proxyPath('http://10.0.0.1/secret.png'))).status).toBe(404);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
