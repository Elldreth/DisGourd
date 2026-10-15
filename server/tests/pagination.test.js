// P1-07: cursor pagination (?before=<id>) for channel and DM history.
const os = require('os');
const path = require('path');

let serverModule;
let port;

beforeAll((done) => {
  process.env.PORT = 0;
  process.env.JWT_SECRET = 'disgourd-test-secret-0123456789abcdef';
  process.env.DB_PATH = ':memory:';
  process.env.UPLOADS_DIR = path.join(os.tmpdir(), `disgourd-test-uploads-page-${process.pid}`);
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

async function register(username) {
  const res = await fetch(`${base()}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'password123', email: `${username}@example.com` }),
  });
  return (await res.json()).token;
}

const ids = (rows) => rows.map((m) => Number(m.id));
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

let ownerToken;
let memberToken;

beforeAll(async () => {
  const { db } = serverModule;
  ownerToken = await register('pager');
  memberToken = await register('reader');
  await fetch(`${base()}/spaces`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...auth(ownerToken) },
    body: JSON.stringify({ name: 'Pages' }),
  });
  const owner = db.getUserByUsername('pager');
  const member = db.getUserByUsername('reader');
  db.addMember(db.getSpaceByName('Pages').id, member.id, 'member');
  db.createChannel('Pages', 'secret');
  db.setChannelPerms('Pages', 'secret', 2, 2); // admins and up
  // 120 channel messages (ids 1-120) and 120 DMs (ids 1-120, their own table).
  for (let i = 1; i <= 120; i++) db.storeMessage('Pages', 'general', `m${i}`, owner.id);
  for (let i = 1; i <= 120; i++) db.storeDm(owner.id, member.id, `d${i}`);
  db.storeMessage('Pages', 'secret', 'hidden', owner.id);
});

function channelPage(query, token = ownerToken, channel = 'general') {
  return fetch(`${base()}/spaces/Pages/channels/${channel}/messages${query}`, { headers: auth(token) });
}
function dmPage(query) {
  return fetch(`${base()}/dms/reader/messages${query}`, { headers: auth(ownerToken) }).then((r) => r.json());
}

describe('channel history', () => {
  test('latest page', async () => {
    expect(ids(await (await channelPage('?limit=50')).json())).toEqual(range(71, 120));
  });
  test('before=71 returns the previous page, oldest-first', async () => {
    expect(ids(await (await channelPage('?before=71&limit=50')).json())).toEqual(range(21, 70));
  });
  test('before=21 returns the short final page', async () => {
    expect(ids(await (await channelPage('?before=21&limit=50')).json())).toEqual(range(1, 20));
  });
  test('garbage before is treated as absent', async () => {
    expect(ids(await (await channelPage('?before=abc&limit=50')).json())).toEqual(range(71, 120));
  });
  test('before takes precedence over offset; after over both', async () => {
    expect(ids(await (await channelPage('?before=71&offset=10&limit=5')).json())).toEqual(range(66, 70));
    expect(ids(await (await channelPage('?after=115&before=71&limit=50')).json())).toEqual(range(116, 120));
  });
  test('private-channel gating still applies to before', async () => {
    const res = await channelPage('?before=200&limit=50', memberToken, 'secret');
    expect(res.status).toBe(403);
  });
});

describe('DM history', () => {
  test('latest page', async () => {
    expect(ids(await dmPage('?limit=50'))).toEqual(range(71, 120));
  });
  test('before=71 returns the previous page', async () => {
    expect(ids(await dmPage('?before=71&limit=50'))).toEqual(range(21, 70));
  });
  test('before=21 returns the short final page', async () => {
    expect(ids(await dmPage('?before=21&limit=50'))).toEqual(range(1, 20));
  });
  test('garbage before is treated as absent', async () => {
    expect(ids(await dmPage('?before=abc&limit=50'))).toEqual(range(71, 120));
  });
});
