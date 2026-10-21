// P3-06: a new server can start from a template of channels.
const os = require('os');
const path = require('path');

let serverModule;
let port;
let token;

beforeAll(async () => {
  process.env.PORT = 0;
  process.env.JWT_SECRET = 'disgourd-test-secret-0123456789abcdef';
  process.env.DB_PATH = ':memory:';
  process.env.UPLOADS_DIR = path.join(os.tmpdir(), `disgourd-test-uploads-tpl-${process.pid}`);
  serverModule = require('../server');
  await new Promise((r) => serverModule.httpServer.listen(0, r));
  port = serverModule.httpServer.address().port;
  const res = await fetch(`http://localhost:${port}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'maker', password: 'gourd-test-pass-1', email: 'maker@example.com' }),
  });
  token = (await res.json()).token;
});
afterAll((done) => {
  serverModule.httpServer.close(done);
});

const create = (body) =>
  fetch(`http://localhost:${port}/spaces`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
async function channelsOf(name) {
  const res = await fetch(`http://localhost:${port}/spaces`, { headers: { Authorization: `Bearer ${token}` } });
  const s = (await res.json()).find((x) => x.name === name);
  return { text: s.channels, voice: s.voiceChannels };
}

test.each([
  ['blank', ['general'], []],
  ['friends', ['general', 'memes', 'media'], ['lounge']],
  ['gaming', ['general', 'lfg', 'clips'], ['squad-1', 'squad-2']],
  ['study', ['general', 'resources', 'questions'], ['study-room']],
])('the %s template creates exactly its channels', async (template, text, voice) => {
  const res = await create({ name: `T ${template}`, template });
  expect(res.status).toBe(201);
  expect(await res.json()).toMatchObject({ name: `T ${template}`, channels: text, voiceChannels: voice });
  expect(await channelsOf(`T ${template}`)).toEqual({ text, voice });
});

test('an unknown or missing template means blank', async () => {
  await create({ name: 'Mystery', template: 'casino' });
  expect(await channelsOf('Mystery')).toEqual({ text: ['general'], voice: [] });
  await create({ name: 'Plain' });
  expect(await channelsOf('Plain')).toEqual({ text: ['general'], voice: [] });
  await create({ name: 'Proto', template: '__proto__' });
  expect(await channelsOf('Proto')).toEqual({ text: ['general'], voice: [] });
});

test('a refused create leaves nothing behind', async () => {
  const { db } = serverModule;
  const count = () => db.raw.prepare('SELECT COUNT(*) AS n FROM channels').get().n;
  const before = count();
  const res = await create({ name: 'T gaming', template: 'gaming' }); // name taken
  expect(res.status).toBe(409);
  expect(count()).toBe(before);
});

test('the template list is what the server offers', () => {
  const { SERVER_TEMPLATES } = serverModule.db;
  expect(Object.keys(SERVER_TEMPLATES)).toEqual(['blank', 'friends', 'gaming', 'study']);
});
