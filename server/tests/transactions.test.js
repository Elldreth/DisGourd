// P1-06: multi-step writes are atomic, and concurrent sign-ups / invite joins
// can't overrun their limits.
const os = require('os');
const path = require('path');

let serverModule;
let port;

beforeAll((done) => {
  process.env.PORT = 0;
  process.env.JWT_SECRET = 'disgourd-test-secret-0123456789abcdef';
  process.env.DB_PATH = ':memory:';
  process.env.UPLOADS_DIR = path.join(os.tmpdir(), `disgourd-test-uploads-tx-${process.pid}`);
  serverModule = require('../server');
  serverModule.httpServer.listen(0, () => {
    port = serverModule.httpServer.address().port;
    done();
  });
});

afterAll((done) => {
  serverModule.httpServer.close(done);
});

const base = () => `http://localhost:${port}`;
const auth = (t) => ({ Authorization: `Bearer ${t}` });

function register(username, extra = {}) {
  return fetch(`${base()}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'password123', email: `${username}@example.com`, ...extra }),
  });
}

let owner; // { id, token }

beforeAll(async () => {
  // The first account bypasses registration gating, so create it up front.
  const res = await register('txowner');
  owner = { token: (await res.json()).token, id: serverModule.db.getUserByUsername('txowner').id };
});

afterEach(() => {
  serverModule.db.setSetting('registration_mode', 'open');
});

test('creating a server with its default channels is all-or-nothing', () => {
  const { db } = serverModule;
  // A duplicate channel name violates UNIQUE(space_id, name) part-way through.
  expect(() => db.createSpaceWithDefaults('Boom', owner.id, [{ name: 'general' }, { name: 'general' }])).toThrow();
  expect(db.getSpaceByName('Boom')).toBeUndefined();

  const id = db.createSpaceWithDefaults('Fine', owner.id);
  expect(id).toBeTruthy();
  expect(db.getMemberRole(id, owner.id)).toBe('owner');
  expect(db.channelType('Fine', 'general')).toBe('text');
  expect(db.createSpaceWithDefaults('Fine', owner.id)).toBeNull(); // name taken
});

test('a message, its read marker and its mentions are stored together', async () => {
  const { db } = serverModule;
  await register('mentioned');
  const space = db.getSpaceByName('Fine');
  db.addMember(space.id, db.getUserByUsername('mentioned').id, 'member');
  const stored = db.storeMessageWithMentions(
    'Fine', 'general', 'hi @mentioned and @nobody', owner.id, [], false, space.id, ['mentioned', 'nobody']
  );
  expect(stored.mentions).toEqual(['mentioned']);
  expect(db.getMentionCounts(db.getUserByUsername('mentioned').id))
    .toEqual(expect.arrayContaining([expect.objectContaining({ space: 'Fine', channel: 'general' })]));
});

test('an invite with max_uses = 1 admits exactly one of two concurrent joiners', async () => {
  const { db } = serverModule;
  const space = db.getSpaceByName('Fine');
  db.createInvite('once-only', space.id, owner.id, null, 1);
  const tokens = [];
  for (const name of ['joinera', 'joinerb']) tokens.push((await (await register(name)).json()).token);
  const results = await Promise.all(tokens.map((t) =>
    fetch(`${base()}/invites/once-only`, { method: 'POST', headers: auth(t) })));
  expect(results.map((r) => r.status).sort()).toEqual([200, 410]);
  expect(db.getInvite('once-only').uses).toBe(1);
});

test('a registration code with max_uses = 1 creates exactly one account under concurrency', async () => {
  const { db } = serverModule;
  db.setSetting('registration_mode', 'code');
  db.addRegCode('single-use', owner.id, null, 1);
  const results = await Promise.all(['racer1', 'racer2', 'racer3'].map((u) => register(u, { code: 'single-use' })));
  const statuses = results.map((r) => r.status).sort();
  expect(statuses).toEqual([201, 403, 403]);
  expect(db.findUsableRegCode('single-use')).toBeNull();
});

test('two concurrent sign-ups with the same username: one 201, one clean 409', async () => {
  const results = await Promise.all([
    register('samename', { email: 'one@example.com' }),
    register('samename', { email: 'two@example.com' }),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  const loser = results.find((r) => r.status === 409);
  const body = await loser.json();
  expect(body.error).toBe('User already exists');
  expect(JSON.stringify(body)).not.toMatch(/sqlite|unique|constraint/i);
});
