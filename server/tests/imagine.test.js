// P2-20a: the /imagine core with the fake engine — the bot, settings, who may
// use it, limits, the queue, the 18+ rule and restart recovery.
const WebSocket = require('ws');
const fs = require('fs');
const os = require('os');
const path = require('path');

let serverModule;
let db;
let imagine;
let port;
const UPLOADS = path.join(os.tmpdir(), `disgourd-test-uploads-imagine-${process.pid}`);
const users = {}; // name -> { token, id, gw, frames }
const SPACE = 'Studio';

beforeAll((done) => {
  process.env.PORT = 0;
  process.env.JWT_SECRET = 'disgourd-test-secret-0123456789abcdef';
  process.env.DB_PATH = ':memory:';
  process.env.UPLOADS_DIR = UPLOADS;
  process.env.IMAGINE_FAKE_ENGINE = '1';
  process.env.IMAGINE_FAKE_DELAY_MS = '40';
  process.env.IMAGINE_TIMEOUT_MS = '600';
  serverModule = require('../server');
  db = serverModule.db;
  imagine = require('../imagine');
  serverModule.httpServer.listen(0, () => {
    port = serverModule.httpServer.address().port;
    done();
  });
});
afterAll((done) => {
  for (const u of Object.values(users)) u.gw?.close();
  serverModule.httpServer.close(done);
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 3000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out waiting');
    await wait(15);
  }
}
const base = () => `http://localhost:${port}`;
const call = async (who, method, p, body) => {
  const res = await fetch(`${base()}${p}`, {
    method,
    headers: { 'content-type': 'application/json', ...(who ? { Authorization: `Bearer ${users[who].token}` } : {}) },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const S = `/spaces/${SPACE}`;
const send = (who, frame) => users[who].gw.send(JSON.stringify(frame));
const framesOf = (who, type) => users[who].frames.filter((f) => f.type === type);
// Send an imagine op and wait for its answer: queued, or a refusal code.
async function ask(who, fields) {
  const isAnswer = (f) => f.type === 'imagine_queued' || (f.type === 'error' && f.op === 'imagine');
  const from = users[who].frames.length;
  send(who, { op: 'imagine', space: SPACE, channel: 'general', prompt: 'a gourd in a hat', ...fields });
  const answer = await until(() => users[who].frames.slice(from).find(isAnswer));
  return answer.type === 'error' ? answer.code : answer;
}
const botMessage = (id) => db.raw.prepare('SELECT content, attachments FROM messages WHERE id = ?').get(id);

async function register(username) {
  const res = await fetch(`${base()}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'password123', email: `${username}@example.com` }),
  });
  return (await res.json()).token;
}
function connect(who) {
  const u = users[who];
  u.gw = new WebSocket(`ws://localhost:${port}/gateway?token=${u.token}`);
  u.gw.on('message', (raw) => u.frames.push(JSON.parse(raw.toString())));
  return new Promise((r) => u.gw.on('open', r));
}

let spaceId;
let artists;
beforeAll(async () => {
  for (const name of ['owner', 'artist', 'viewer', 'outsider']) {
    const token = await register(name);
    users[name] = { token, id: db.getUserByUsername(name).id, frames: [] };
  }
  spaceId = db.createSpaceWithDefaults(SPACE, users.owner.id);
  db.addMember(spaceId, users.artist.id, 'member');
  db.addMember(spaceId, users.viewer.id, 'member');
  artists = db.createRole(spaceId, { name: 'Artists', permissions: ['generate_images'] });
  db.addMemberRole(spaceId, users.artist.id, artists.id);
  for (const n of Object.keys(users)) await connect(n);
});

test('the bot exists, can never sign in, and does not take the first-account admin slot', async () => {
  const bot = db.getUserById(db.ensureImagineBot());
  expect(bot).toMatchObject({ username: 'Imagine', is_bot: 1, site_admin: 0 });
  const login = await fetch(`${base()}/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'Imagine', password: '!' }) });
  expect(login.status).toBe(401);
  expect(db.isSiteAdmin(users.owner.id)).toBe(true); // the first person, not the bot
  expect(db.countUsers()).toBe(4);
});

test('instance settings: site admins only, unknown engines refused, values round-trip', async () => {
  expect((await call('artist', 'GET', '/admin/imagine')).status).toBe(403);
  expect((await call('owner', 'PUT', '/admin/imagine', { engines: { nope: { enabled: true } } })).status).toBe(400);
  expect((await call('owner', 'PUT', '/admin/imagine', { dailyLimit: 500 })).status).toBe(400); // over the ceiling of 100
  const saved = await call('owner', 'PUT', '/admin/imagine', { engines: { fake: { enabled: true } }, defaultEngine: 'fake', dailyLimit: 10 });
  expect(saved.status).toBe(200);
  expect(saved.body).toMatchObject({ defaultEngine: 'fake', permissive: false, dailyLimit: 10 });
  expect(saved.body.engines.find((e) => e.id === 'fake')).toMatchObject({ config: { enabled: true } });
  expect((await call('owner', 'GET', '/admin/imagine')).body.dailyLimit).toBe(10);
});

test('server and channel settings: who may change them, the limit cap, and what GET /spaces says', async () => {
  expect((await call('artist', 'PATCH', `${S}/imagine`, { enabled: true })).status).toBe(403);
  expect((await call('owner', 'PATCH', `${S}/imagine`, { dailyLimit: 1000 })).status).toBe(400);
  let mine = (await call('artist', 'GET', '/spaces')).body.find((s) => s.name === SPACE);
  expect(mine.imagine).toMatchObject({ enabled: false, canUse: true, dailyLimit: 10, usedToday: 0, engines: [{ id: 'fake', name: 'Test engine' }] });
  expect((await call('owner', 'PATCH', `${S}/imagine`, { enabled: true, dailyLimit: 5 })).body).toMatchObject({ enabled: true, dailyLimit: 5, effectiveLimit: 5 });
  mine = (await call('viewer', 'GET', '/spaces')).body.find((s) => s.name === SPACE);
  expect(mine.imagine).toMatchObject({ enabled: true, canUse: false, dailyLimit: 5 });
  expect(mine.channelMeta.general.nsfw).toBe(false);
  // The 18+ switch: managers only.
  db.createChannel(SPACE, 'after-dark');
  expect((await call('artist', 'PATCH', `${S}/channels/after-dark`, { nsfw: true })).status).toBe(403);
  expect((await call('owner', 'PATCH', `${S}/channels/after-dark`, { nsfw: 'yes' })).status).toBe(400);
  expect((await call('owner', 'PATCH', `${S}/channels/after-dark`, { nsfw: true })).status).toBe(200);
  expect((await call('viewer', 'GET', '/spaces')).body.find((s) => s.name === SPACE).channelMeta['after-dark'].nsfw).toBe(true);
  // A new server's Admin role carries the new permission.
  const other = db.createSpaceWithDefaults('Elsewhere', users.owner.id);
  expect(db.getRoles(other).find((r) => r.name === 'Admin').permissions).toContain('generate_images');
});

test('refusals, each with its code', async () => {
  expect(await ask('outsider', {})).toBe('NOT_ALLOWED');
  expect(await ask('viewer', {})).toBe('NO_PERMISSION');
  expect(await ask('artist', { prompt: '   ' })).toBe('BAD_PROMPT');
  expect(await ask('artist', { prompt: 'x'.repeat(1001) })).toBe('BAD_PROMPT');
  expect(await ask('artist', { shape: 'round' })).toBe('BAD_OPTION');
  expect(await ask('artist', { quality: 'ultra' })).toBe('BAD_OPTION');
  expect(await ask('artist', { engine: 'comfyui' })).toBe('BAD_OPTION');
  expect(await ask('artist', { prompt: 'nude 12 year old' })).toBe('REFUSED');
  await call('owner', 'PATCH', `${S}/imagine`, { enabled: false });
  expect(await ask('artist', {})).toBe('DISABLED');
  await call('owner', 'PATCH', `${S}/imagine`, { enabled: true });
  await call('owner', 'PUT', '/admin/imagine', { engines: { fake: { enabled: false } } });
  expect(await ask('artist', {})).toBe('NO_ENGINE');
  await call('owner', 'PUT', '/admin/imagine', { engines: { fake: { enabled: true } } });
  expect(db.countImagineJobsSince(users.artist.id, 0)).toBe(0); // nothing was queued
});

test('a request: the placeholder reaches the channel, then turns into the image', async () => {
  const queued = await ask('artist', { prompt: 'a gourd wearing a top hat', shape: 'landscape' });
  expect(queued).toMatchObject({ space: SPACE, channel: 'general' });
  const placeholder = await until(() => framesOf('viewer', 'message').find((f) => f.id === queued.messageId));
  expect(placeholder).toMatchObject({ author: 'Imagine', bot: true, attachments: [] });
  expect(placeholder.content).toMatch(/Imagining for \*\*artist\*\*/);
  expect(framesOf('outsider', 'message').some((f) => f.id === queued.messageId)).toBe(false);
  const done = await until(() => framesOf('viewer', 'message_update').find((f) => f.id === queued.messageId && f.attachments.length));
  expect(done.content).toBe('🎨 **artist** imagined: a gourd wearing a top hat');
  const file = path.join(UPLOADS, done.attachments[0].replace(/^\/uploads\//, ''));
  expect(fs.readFileSync(file).subarray(1, 4).toString()).toBe('PNG');
  expect(JSON.parse(botMessage(queued.messageId).attachments)).toEqual(done.attachments);
  expect(db.getImagineJob(queued.jobId)).toMatchObject({ status: 'done', engine: 'fake', shape: 'landscape', model: 'fake' });
  const history = (await call('viewer', 'GET', `${S}/channels/general/messages`)).body;
  expect(history.find((m) => m.id === queued.messageId)).toMatchObject({ author: 'Imagine', attachments: done.attachments });
});

test('one at a time: a second request waits its turn and says where it stands', async () => {
  const first = await ask('artist', { prompt: 'slow one [slow]' });
  const second = await ask('owner', { prompt: 'the next one' });
  const secondPlaceholder = framesOf('viewer', 'message').find((f) => f.id === second.messageId);
  expect(secondPlaceholder.content).toMatch(/2nd in line$/);
  await until(() => framesOf('viewer', 'message_update').some((f) => f.id === second.messageId && /generating$/.test(f.content)));
  expect(db.getImagineJob(first.jobId).status).toBe('done'); // the first finished before the second started
  await until(() => imagine.idle());
});

test('a failure and a timeout replace the placeholder with the reason', async () => {
  const failed = await ask('artist', { prompt: 'please [fail]' });
  await until(() => db.getImagineJob(failed.jobId).status === 'failed');
  expect(botMessage(failed.messageId).content).toBe("⚠️ Couldn't imagine that for **artist**: The test engine failed on purpose");
  const hung = await ask('owner', { prompt: 'never ends [hang]' });
  await until(() => db.getImagineJob(hung.jobId).status === 'failed', 3000);
  expect(botMessage(hung.messageId).content).toMatch(/it took too long$/);
  await until(() => imagine.idle());
});

test('permissive only in an 18+ channel (or a thread under one) when the instance allows it', async () => {
  await call('owner', 'PATCH', `${S}/imagine`, { dailyLimit: null }); // back to the instance's 10
  const fake = imagine.ENGINES.get('fake');
  const real = fake.generate;
  const seen = [];
  fake.generate = (req, cfg, opts) => {
    seen.push(opts.permissive);
    return real(req, cfg, opts);
  };
  try {
    const run = async (channel) => {
      const q = await ask('owner', { channel });
      await until(() => db.getImagineJob(q.jobId).status === 'done');
    };
    await run('general'); // plain channel
    await run('after-dark'); // 18+, but the instance hasn't allowed permissive
    await call('owner', 'PUT', '/admin/imagine', { permissive: true });
    await run('general');
    await run('after-dark');
    const root = db.storeMessage(SPACE, 'after-dark', 'thread root', users.owner.id);
    const thread = (await call('owner', 'POST', `${S}/channels/after-dark/threads`, { messageId: Number(root.id), name: 'late' })).body.thread;
    await run(thread.channel || `~t${root.id}`);
    expect(seen).toEqual([false, false, false, true, true]);
  } finally {
    fake.generate = real;
    await call('owner', 'PUT', '/admin/imagine', { permissive: false });
  }
});

test('the daily limit counts what you asked for (not failures)', async () => {
  const used = db.countImagineJobsSince(users.artist.id, Date.now() - 86400000);
  await call('owner', 'PATCH', `${S}/imagine`, { dailyLimit: used });
  expect(await ask('artist', {})).toBe('LIMIT');
  expect((await call('artist', 'GET', '/spaces')).body.find((s) => s.name === SPACE).imagine).toMatchObject({ usedToday: used, dailyLimit: used });
  await call('owner', 'PATCH', `${S}/imagine`, { dailyLimit: null });
});

test('after a restart, jobs that were waiting or running are marked failed and say so', () => {
  const runner = require('../imagine/runner');
  const msg = db.postAsBot(SPACE, 'general', '🎨 Imagining for **artist**… 2nd in line');
  const id = db.createImagineJob({ userId: users.artist.id, spaceId, channelId: db.channelRef(SPACE, 'general').channelId, engine: 'fake', prompt: 'p', shape: 'square', quality: 'draft' });
  db.updateImagineJob(id, { messageId: Number(msg.id) });
  runner.recover();
  expect(db.getImagineJob(id)).toMatchObject({ status: 'failed', error: 'the server restarted' });
  expect(botMessage(Number(msg.id)).content).toBe("⚠️ Couldn't imagine that for **artist**: the server restarted");
});
