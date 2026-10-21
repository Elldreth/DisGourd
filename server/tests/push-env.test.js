// P11-14 AC-1: with VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY set, the server uses
// them and hands the public one to browsers.
const os = require('os');
const path = require('path');
const webpush = require('web-push');

const pair = webpush.generateVAPIDKeys();
let serverModule;
let port;

beforeAll(async () => {
  process.env.VAPID_PUBLIC_KEY = pair.publicKey;
  process.env.VAPID_PRIVATE_KEY = pair.privateKey;
  process.env.PORT = 0;
  process.env.JWT_SECRET = 'disgourd-test-secret-0123456789abcdef';
  process.env.DB_PATH = ':memory:';
  process.env.UPLOADS_DIR = path.join(os.tmpdir(), `disgourd-test-uploads-push-env-${process.pid}`);
  serverModule = require('../server');
  await new Promise((r) => serverModule.httpServer.listen(0, r));
  port = serverModule.httpServer.address().port;
});
afterAll((done) => {
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  serverModule.httpServer.close(done);
});

test('/push/vapid-key returns the public key from the environment', async () => {
  const reg = await fetch(`http://localhost:${port}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'vapidenv', password: 'gourd-test-pass-1', email: 'vapidenv@example.com' }),
  });
  const { token } = await reg.json();
  const res = await fetch(`http://localhost:${port}/push/vapid-key`, { headers: { Authorization: `Bearer ${token}` } });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ key: pair.publicKey });
});
