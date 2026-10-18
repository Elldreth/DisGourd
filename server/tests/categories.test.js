// P3-25a: channel categories — the migration for existing servers, the
// category and layout routes, where new channels go, templates, and the live
// update to members.
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const WebSocket = require('ws');
const { MIGRATIONS, runMigrations } = require('../db/migrations');

let serverModule;
let db;
let port;
const users = {};
const SPACE = 'Sorted';

beforeAll((done) => {
  process.env.PORT = 0;
  process.env.JWT_SECRET = 'disgourd-test-secret-0123456789abcdef';
  process.env.DB_PATH = ':memory:';
  process.env.UPLOADS_DIR = path.join(os.tmpdir(), `disgourd-test-uploads-categories-${process.pid}`);
  serverModule = require('../server');
  db = serverModule.db;
  serverModule.httpServer.listen(0, () => {
    port = serverModule.httpServer.address().port;
    done();
  });
});
afterAll((done) => {
  for (const u of Object.values(users)) u.gw?.close();
  serverModule.httpServer.close(done);
});

const call = async (who, method, p, body) => {
  const res = await fetch(`http://localhost:${port}${p}`, {
    method, headers: { 'content-type': 'application/json', Authorization: `Bearer ${users[who].token}` }, body: body && JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const S = `/spaces/${SPACE}`;
const mine = async (who, space = SPACE) => (await call(who, 'GET', '/spaces')).body.find((s) => s.name === space);
// The list as a member sees it: [category name or '(top)', [channel names…]].
async function layout(who) {
  const s = await mine(who);
  const groups = [[null, '(top)'], ...s.categories.map((c) => [c.id, c.name])];
  const all = [...s.channels, ...s.voiceChannels].sort((a, b) => order(s, a) - order(s, b));
  return groups.map(([id, name]) => [name, all.filter((n) => s.channelMeta[n].category === id)]);
}
const order = (s, name) => {
  const m = s.channelMeta[name];
  const cat = m.category === null ? -1 : s.categories.findIndex((c) => c.id === m.category);
  return cat * 1000 + m.position;
};

let spaceId;
beforeAll(async () => {
  for (const name of ['owner', 'member', 'outsider']) {
    const res = await fetch(`http://localhost:${port}/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: name, password: 'password123', email: `${name}@example.com` }),
    });
    users[name] = { token: (await res.json()).token, id: db.getUserByUsername(name).id, frames: [] };
  }
  spaceId = db.createSpaceWithDefaults(SPACE, users.owner.id, [
    { name: 'general', type: 'text' }, { name: 'memes', type: 'text' }, { name: 'lounge', type: 'voice' },
  ]);
  db.addMember(spaceId, users.member.id, 'member');
  for (const who of ['member', 'outsider']) {
    const u = users[who];
    u.gw = new WebSocket(`ws://localhost:${port}/gateway?token=${u.token}`);
    u.gw.on('message', (raw) => u.frames.push(JSON.parse(raw.toString())));
    await new Promise((r) => u.gw.on('open', r));
  }
});

test('migration 17: an existing server gets "Text channels" and "Voice channels" holding what it had, in order; threads stay out', () => {
  const raw = new Database(':memory:');
  raw.pragma('foreign_keys = ON');
  runMigrations(raw, MIGRATIONS.filter((m) => m.version < 17));
  raw.prepare("INSERT INTO spaces(name) VALUES ('Old')").run();
  const add = raw.prepare('INSERT INTO channels(space_id, name, type) VALUES (1, ?, ?)');
  for (const [n, t] of [['b-general', 'text'], ['voice-1', 'voice'], ['a-random', 'text'], ['~t5', 'thread']]) add.run(n, t);
  runMigrations(raw);
  expect(raw.prepare('SELECT name, position FROM channel_categories ORDER BY position').all()).toEqual([
    { name: 'Text channels', position: 0 }, { name: 'Voice channels', position: 1 },
  ]);
  const rows = raw.prepare('SELECT c.name, k.name AS category, c.position FROM channels c LEFT JOIN channel_categories k ON k.id = c.category_id ORDER BY c.id').all();
  expect(rows).toEqual([
    { name: 'b-general', category: 'Text channels', position: 0 },
    { name: 'voice-1', category: 'Voice channels', position: 0 },
    { name: 'a-random', category: 'Text channels', position: 1 }, // creation order, not name
    { name: '~t5', category: null, position: 0 },
  ]);
  runMigrations(raw); // again: nothing changes
  expect(raw.prepare('SELECT COUNT(*) AS n FROM channel_categories').get().n).toBe(2);
});

test('a new server starts with the two categories; GET /spaces carries the order', async () => {
  expect(await layout('member')).toEqual([['(top)', []], ['Text channels', ['general', 'memes']], ['Voice channels', ['lounge']]]);
  expect((await mine('member')).categories.map((c) => c.position)).toEqual([0, 1]);
});

test('categories: managers create, rename and delete (keeping the channels); members are refused; everyone is told', async () => {
  const from = users.member.frames.length;
  expect((await call('member', 'POST', `${S}/categories`, { name: 'Mine' })).status).toBe(403);
  expect((await call('owner', 'POST', `${S}/categories`, { name: '   ' })).body).toEqual({ error: 'Category names are 1–50 characters' });
  expect((await call('owner', 'POST', `${S}/categories`, { name: 'x'.repeat(51) })).status).toBe(400);
  const games = await call('owner', 'POST', `${S}/categories`, { name: '  Games ' });
  expect(games).toMatchObject({ status: 201, body: { name: 'Games', position: 2 } });
  await new Promise((r) => setTimeout(r, 50));
  expect(users.member.frames.slice(from).some((f) => f.type === 'space_updated' && f.space === SPACE)).toBe(true);
  expect(users.outsider.frames.some((f) => f.type === 'space_updated' && f.space === SPACE)).toBe(false);
  expect((await call('owner', 'PATCH', `${S}/categories/${games.body.id}`, { name: 'Gaming' })).body).toEqual({ id: games.body.id, name: 'Gaming' });
  expect((await call('owner', 'PATCH', `${S}/categories/99999`, { name: 'Nope' })).status).toBe(404);
  // A channel created in it, then the category deleted: the channel moves to the top, after what's there.
  expect((await call('owner', 'POST', `${S}/channels`, { name: 'minecraft', category: games.body.id })).status).toBe(201);
  expect((await call('owner', 'POST', `${S}/channels`, { name: 'loose', category: null })).status).toBe(201);
  expect(await layout('member')).toEqual([['(top)', ['loose']], ['Text channels', ['general', 'memes']], ['Voice channels', ['lounge']], ['Gaming', ['minecraft']]]);
  expect((await call('member', 'DELETE', `${S}/categories/${games.body.id}`)).status).toBe(403);
  expect((await call('owner', 'DELETE', `${S}/categories/${games.body.id}`)).body).toEqual({ ok: true });
  expect(await layout('member')).toEqual([['(top)', ['loose', 'minecraft']], ['Text channels', ['general', 'memes']], ['Voice channels', ['lounge']]]);
  expect((await call('owner', 'DELETE', `${S}/categories/${games.body.id}`)).status).toBe(404);
  // Another server's category id can't be used here.
  const otherId = db.createSpaceWithDefaults('Elsewhere', users.owner.id);
  const foreign = db.getCategories(otherId)[0].id;
  expect((await call('owner', 'POST', `${S}/channels`, { name: 'sneaky', category: foreign })).body).toEqual({ error: 'No such category' });
  expect((await call('owner', 'DELETE', `${S}/categories/${foreign}`)).status).toBe(404);
});

test('new channels go to the end of their category: the one asked for, else the default for their type', async () => {
  await call('owner', 'POST', `${S}/channels`, { name: 'news' });
  await call('owner', 'POST', `${S}/channels`, { name: 'stage', type: 'voice' });
  const l = await layout('owner');
  expect(l[1]).toEqual(['Text channels', ['general', 'memes', 'news']]);
  expect(l[2]).toEqual(['Voice channels', ['lounge', 'stage']]);
  // With the default category renamed away, a new channel goes to the top.
  const text = (await mine('owner')).categories.find((c) => c.name === 'Text channels');
  await call('owner', 'PATCH', `${S}/categories/${text.id}`, { name: 'Chat' });
  await call('owner', 'POST', `${S}/channels`, { name: 'orphan' });
  expect((await layout('owner'))[0]).toEqual(['(top)', ['loose', 'minecraft', 'orphan']]);
  await call('owner', 'PATCH', `${S}/categories/${text.id}`, { name: 'Text channels' });
});

test('layout: one request reorders categories and moves channels; positions come back contiguous', async () => {
  const s = await mine('owner');
  const [text, voice] = s.categories.map((c) => c.id);
  const music = (await call('owner', 'POST', `${S}/categories`, { name: 'Music' })).body.id;
  const out = await call('owner', 'PUT', `${S}/layout`, {
    categories: [music, voice, text],
    channels: [
      { name: 'general', category: null },
      { name: 'stage', category: music }, { name: 'lounge', category: music },
      { name: 'news', category: text }, { name: 'memes', category: text }, { name: 'orphan', category: text },
      { name: 'loose', category: voice }, { name: 'minecraft', category: voice },
    ],
  });
  expect(out.status).toBe(200);
  expect(out.body.categories.map((c) => [c.name, c.position])).toEqual([['Music', 0], ['Voice channels', 1], ['Text channels', 2]]);
  expect(await layout('member')).toEqual([
    ['(top)', ['general']], ['Music', ['stage', 'lounge']], ['Voice channels', ['loose', 'minecraft']], ['Text channels', ['news', 'memes', 'orphan']],
  ]);
  const meta = (await mine('owner')).channelMeta;
  expect(['news', 'memes', 'orphan'].map((n) => meta[n].position)).toEqual([0, 1, 2]);
});

test('layout: refused unless it lists every category and visible channel exactly once, in this server; managers only', async () => {
  const s = await mine('owner');
  const cats = s.categories.map((c) => c.id);
  const chans = Object.keys(s.channelMeta).map((name) => ({ name, category: s.channelMeta[name].category }));
  const put = (body, who = 'owner') => call(who, 'PUT', `${S}/layout`, body);
  expect((await put({ categories: cats, channels: chans }, 'member')).status).toBe(403);
  expect((await put({ categories: cats.slice(1), channels: chans })).status).toBe(400); // a category missing
  expect((await put({ categories: [...cats, cats[0]], channels: chans })).status).toBe(400); // twice
  expect((await put({ categories: cats, channels: chans.slice(1) })).status).toBe(400); // a channel missing
  expect((await put({ categories: cats, channels: [...chans, { name: 'ghost', category: null }] })).status).toBe(400);
  expect((await put({ categories: cats, channels: [...chans.slice(1), chans[1]] })).status).toBe(400); // duplicate
  const foreign = db.getCategories(db.getSpaceByName('Elsewhere').id)[0].id;
  expect((await put({ categories: cats, channels: chans.map((c, i) => (i ? c : { ...c, category: foreign })) })).status).toBe(400);
  expect((await put({ categories: 'nope', channels: chans })).status).toBe(400);
  expect((await put({ categories: cats, channels: chans })).status).toBe(200); // the same layout is fine
});

test('layout: channels the manager can’t see keep their category and follow the listed ones', async () => {
  // A private channel the arranging role can't see, in "Text channels".
  const mod = db.createRole(spaceId, { name: 'Arrangers', permissions: ['create_channel'] });
  db.addMemberRole(spaceId, users.member.id, mod.id);
  db.createChannel(SPACE, 'secret', 'text', db.getCategories(spaceId).find((c) => c.name === 'Text channels').id);
  const everyone = db.raw.prepare('SELECT id FROM roles WHERE space_id = ? AND is_default = 1').get(spaceId).id;
  db.setChannelOverride(db.channelRef(SPACE, 'secret').channelId, everyone, { view: 0, post: 0 });
  expect(Object.keys((await mine('member')).channelMeta)).not.toContain('secret');
  expect(Object.keys((await mine('owner')).channelMeta)).toContain('secret');
  const s = await mine('member');
  const text = s.categories.find((c) => c.name === 'Text channels').id;
  const chans = Object.keys(s.channelMeta).map((name) => ({ name, category: s.channelMeta[name].category }));
  // The member moves "news" to the end of Text channels; "secret" (unseen) stays in Text channels, after the listed ones.
  const reordered = [...chans.filter((c) => c.name !== 'news'), { name: 'news', category: text }];
  expect((await call('member', 'PUT', `${S}/layout`, { categories: s.categories.map((c) => c.id), channels: reordered })).status).toBe(200);
  const owner = await mine('owner');
  const inText = Object.keys(owner.channelMeta).filter((n) => owner.channelMeta[n].category === text).sort((a, b) => owner.channelMeta[a].position - owner.channelMeta[b].position);
  expect(inText).toEqual(['memes', 'orphan', 'news', 'secret']);
});

test('templates: a server made from a template has its channels in the two categories', async () => {
  const made = await call('owner', 'POST', '/spaces', { name: 'Study Hall', template: 'study' });
  expect(made.status).toBeLessThan(300);
  const s = await mine('owner', 'Study Hall');
  expect(s.categories.map((c) => c.name)).toEqual(['Text channels', 'Voice channels']);
  const [text, voice] = s.categories.map((c) => c.id);
  expect(['general', 'resources', 'questions'].map((n) => [s.channelMeta[n].category, s.channelMeta[n].position])).toEqual([[text, 0], [text, 1], [text, 2]]);
  expect(s.channelMeta['study-room']).toMatchObject({ category: voice, position: 0 });
});
