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
    body: JSON.stringify({ username, password: 'gourd-test-pass-1', email: `${username}@example.com` }),
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
  expect(mine.imagine).toMatchObject({ enabled: true, canUse: false, dailyLimit: 5, ownLimit: 5 });
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
  expect(done.attachments[0]).toMatch(/^\/uploads\/[a-f0-9]+\/disgourd-\d{4}-\d{2}-\d{2}-\d{6}\.png$/); // P3-32: a date/time name
  const file = path.join(UPLOADS, done.attachments[0].replace(/^\/uploads\//, ''));
  expect(fs.readFileSync(file).subarray(1, 4).toString()).toBe('PNG');
  expect(JSON.parse(botMessage(queued.messageId).attachments)).toEqual(done.attachments);
  expect(db.getImagineJob(queued.jobId)).toMatchObject({ status: 'done', engine: 'fake', shape: 'landscape', model: 'fake' });
  const history = (await call('viewer', 'GET', `${S}/channels/general/messages`)).body;
  expect(history.find((m) => m.id === queued.messageId)).toMatchObject({ author: 'Imagine', bot: true, attachments: done.attachments });
  expect(history.filter((m) => m.author !== 'Imagine').every((m) => !('bot' in m))).toBe(true); // people's messages carry no flag
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
  expect(botMessage(hung.messageId).content).toMatch(/DisGourd stopped waiting after \d+ seconds? \(the image engine hadn't finished\)$/);
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

test('the limit refusal says where the number is set (server, instance or ceiling); Settings lists server overrides', async () => {
  const refusal = async () => {
    const from = users.artist.frames.length;
    send('artist', { op: 'imagine', space: SPACE, channel: 'general', prompt: 'one more' });
    return until(() => users.artist.frames.slice(from).find((f) => f.type === 'error' && f.op === 'imagine'));
  };
  const used = db.countImagineJobsSince(users.artist.id, Date.now() - 86400000);
  const space = async () => (await call('artist', 'GET', '/spaces')).body.find((s) => s.name === SPACE).imagine;
  const before0 = (await call('owner', 'GET', '/admin/imagine')).body;
  // The server's own limit.
  await call('owner', 'PATCH', `${S}/imagine`, { dailyLimit: used });
  expect((await refusal()).error).toBe(`You’ve used all ${used} images for today. ${SPACE} sets its own limit of ${used} a day (Server settings → Image generation).`);
  expect(await space()).toMatchObject({ dailyLimit: used, limitSource: 'server', instanceLimit: before0.dailyLimit });
  expect((await call('owner', 'GET', '/admin/imagine')).body.serverLimits).toEqual([{ space: SPACE, limit: used }]);
  // The instance default.
  await call('owner', 'PATCH', `${S}/imagine`, { dailyLimit: null });
  const before = (await call('owner', 'GET', '/admin/imagine')).body;
  await call('owner', 'PUT', '/admin/imagine', { dailyLimit: used });
  expect((await refusal()).error).toBe(`You’ve used all ${used} images for today. This instance allows ${used} a day (Settings → Image generation).`);
  expect(await space()).toMatchObject({ limitSource: 'instance' });
  expect((await call('owner', 'GET', '/admin/imagine')).body.serverLimits).toEqual([]);
  // The ceiling.
  await call('owner', 'PUT', '/admin/imagine', { dailyCeiling: used, dailyLimit: used });
  await call('owner', 'PATCH', `${S}/imagine`, { dailyLimit: used });
  db.setSpaceImagine(db.getSpaceByName(SPACE).id, { dailyLimit: used + 5 }); // set before the ceiling dropped
  expect((await refusal()).error).toBe(`You’ve used all ${used} images for today. That's this instance's maximum of ${used} a day.`);
  expect(await space()).toMatchObject({ limitSource: 'ceiling' });
  await call('owner', 'PATCH', `${S}/imagine`, { dailyLimit: null });
  await call('owner', 'PUT', '/admin/imagine', { dailyCeiling: before.dailyCeiling, dailyLimit: before.dailyLimit });
});

test('Retry and Variations: `from` repeats a finished request in the same channel, for whoever presses it', async () => {
  await call('owner', 'PATCH', `${S}/imagine`, { dailyLimit: 100 });
  const first = await ask('artist', { prompt: 'a gourd on the moon', shape: 'wide', quality: 'draft' });
  await until(() => db.getImagineJob(first.jobId).status === 'done');
  // Someone else presses Variations: same prompt and options, under their name.
  const usedBefore = db.countImagineJobsSince(users.owner.id, 0);
  const again = await ask('owner', { prompt: undefined, from: first.messageId });
  expect(again).toMatchObject({ space: SPACE, channel: 'general' });
  expect(again.messageId).not.toBe(first.messageId);
  expect(db.getImagineJob(again.jobId)).toMatchObject({ user_id: users.owner.id, prompt: 'a gourd on the moon', shape: 'wide', quality: 'draft', engine: 'fake' });
  await until(() => db.getImagineJob(again.jobId).status === 'done');
  expect(botMessage(again.messageId).content).toBe('🎨 **owner** imagined: a gourd on the moon');
  expect(db.countImagineJobsSince(users.owner.id, 0)).toBe(usedBefore + 1); // counts toward the presser's limit
  // A failed one can be retried.
  const failed = await ask('artist', { prompt: 'retry me [fail]' });
  await until(() => db.getImagineJob(failed.jobId).status === 'failed');
  const retried = await ask('artist', { prompt: undefined, from: failed.messageId });
  expect(db.getImagineJob(retried.jobId).prompt).toBe('retry me [fail]');
  await until(() => imagine.idle());
  // Refused: a running job, another channel, an unknown id, an ordinary message.
  const slow = await ask('artist', { prompt: 'still going [slow]' });
  expect(await ask('artist', { prompt: undefined, from: slow.messageId })).toBe('NOT_FOUND');
  await until(() => imagine.idle());
  db.createChannel(SPACE, 'elsewhere');
  const elsewhere = await ask('artist', { channel: 'elsewhere', prompt: 'over there' });
  await until(() => imagine.idle());
  expect(await ask('artist', { prompt: undefined, from: elsewhere.messageId })).toBe('NOT_FOUND');
  expect(await ask('artist', { prompt: undefined, from: 999999 })).toBe('NOT_FOUND');
  const plain = db.storeMessage(SPACE, 'general', 'just words', users.artist.id);
  expect(await ask('artist', { prompt: undefined, from: Number(plain.id) })).toBe('NOT_FOUND');
  // The usual checks still apply: no permission, and the daily limit.
  expect(await ask('viewer', { prompt: undefined, from: first.messageId })).toBe('NO_PERMISSION');
  await call('owner', 'PATCH', `${S}/imagine`, { dailyLimit: db.countImagineJobsSince(users.owner.id, Date.now() - 864e5) });
  expect(await ask('owner', { prompt: undefined, from: first.messageId })).toBe('LIMIT');
  await call('owner', 'PATCH', `${S}/imagine`, { dailyLimit: null });
});

test('P3-32: saved images are named disgourd-<date>-<time>, with -2… for extras and -upscaled for an upscale', () => {
  const runner = require('../imagine/runner');
  const now = new Date(2026, 9, 8, 7, 5, 3);
  expect(runner.fileStamp(now)).toBe('2026-10-08-070503');
  const png = { buffer: Buffer.from('x'), contentType: 'image/png' };
  const urls = runner.saveImages([png, { ...png, contentType: 'image/jpeg' }], { now });
  expect(urls.map((u) => u.split('/').pop())).toEqual(['disgourd-2026-10-08-070503.png', 'disgourd-2026-10-08-070503-2.jpg']);
  expect(urls[0].split('/')[2]).toBe(urls[1].split('/')[2]); // one folder per request
  expect(runner.saveImages([png], { kind: 'upscale', now })[0]).toMatch(/\/disgourd-2026-10-08-070503-upscaled\.png$/);
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
