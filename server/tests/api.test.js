const fetch = global.fetch || ((...args) => import('node-fetch').then(({default:fetch}) => fetch(...args)));
const WebSocket = require('ws');

let serverModule;
let port;

beforeAll(done => {
  process.env.PORT = 0;
  process.env.JWT_SECRET = 'testsecret';
  process.env.DB_PATH = ':memory:';
  serverModule = require('../server');
  serverModule.httpServer.listen(0, () => {
    port = serverModule.httpServer.address().port;
    done();
  });
});

afterAll(done => {
  serverModule.httpServer.close(done);
});

test('register, login and store messages', async () => {
  const base = `http://localhost:${port}`;
  let res = await fetch(`${base}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'alice', password: 'pw' })
  });
  expect(res.status).toBe(201);

  res = await fetch(`${base}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'alice', password: 'pw' })
  });
  expect(res.status).toBe(200);
  const data = await res.json();
  const token = data.token;
  expect(token).toBeTruthy();

  await new Promise(resolve => {
    const ws = new WebSocket(`ws://localhost:${port}/ws/test/general?token=${token}`);
    ws.on('open', () => {
      ws.send(JSON.stringify({ content: 'hello' }));
      setTimeout(() => {
        ws.close();
        resolve();
      }, 50);
    });
  });

  res = await fetch(`${base}/spaces/test/channels/general/messages?limit=1`);
  const msgs = await res.json();
  expect(msgs.length).toBe(1);
  expect(msgs[0].content).toBe('hello');
});
