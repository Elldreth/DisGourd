// P2-18a: the app shell, the service worker and the manifest are served
// no-cache (so a new deploy is noticed on the next load); fingerprinted
// assets stay immutable.
const os = require('os');
const path = require('path');
const fs = require('fs');

let serverModule;
let port;
let dist;

beforeAll((done) => {
  dist = fs.mkdtempSync(path.join(os.tmpdir(), 'disgourd-dist-'));
  fs.mkdirSync(path.join(dist, 'assets'));
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>t</title>');
  fs.writeFileSync(path.join(dist, 'sw.js'), "const BUILD = 'abc';");
  fs.writeFileSync(path.join(dist, 'manifest.json'), '{}');
  fs.writeFileSync(path.join(dist, 'assets', 'index-abc.js'), 'export {}');
  process.env.PORT = 0;
  process.env.JWT_SECRET = 'disgourd-test-secret-0123456789abcdef';
  process.env.DB_PATH = ':memory:';
  process.env.UPLOADS_DIR = path.join(os.tmpdir(), `disgourd-test-uploads-static-${process.pid}`);
  process.env.WEB_DIST = dist;
  serverModule = require('../server');
  serverModule.httpServer.listen(0, () => {
    port = serverModule.httpServer.address().port;
    done();
  });
});

afterAll((done) => {
  delete process.env.WEB_DIST;
  fs.rmSync(dist, { recursive: true, force: true });
  serverModule.httpServer.close(done);
});

const head = async (p) => {
  const res = await fetch(`http://localhost:${port}${p}`);
  await res.text();
  return { status: res.status, cache: res.headers.get('cache-control'), type: res.headers.get('content-type') };
};

test('the shell, the worker and the manifest are no-cache; assets are immutable', async () => {
  expect(await head('/')).toMatchObject({ status: 200, cache: 'no-cache', type: 'text/html; charset=utf-8' });
  expect(await head('/index.html')).toMatchObject({ status: 200, cache: 'no-cache' });
  expect(await head('/sw.js')).toMatchObject({ status: 200, cache: 'no-cache', type: 'application/javascript; charset=utf-8' });
  expect(await head('/manifest.json')).toMatchObject({ status: 200, cache: 'no-cache' });
  expect(await head('/assets/index-abc.js')).toMatchObject({ status: 200, cache: 'public, max-age=31536000, immutable' });
  // An unknown path falls back to the shell, no-cache too.
  expect(await head('/some/client/route')).toMatchObject({ status: 200, cache: 'no-cache', type: 'text/html; charset=utf-8' });
});
