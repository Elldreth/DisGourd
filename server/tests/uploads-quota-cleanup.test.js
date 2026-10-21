// P11-04: uploads have a daily per-person quota and an optional total cap;
// a file goes when the last thing using it does (messages, DMs, a channel or
// server deleted); a daily sweep removes folders nothing uses; files are
// served sandboxed and cached privately.
const fs = require('fs');
const os = require('os');
const path = require('path');

const UPLOADS = path.join(os.tmpdir(), `disgourd-test-uploads-quota-${process.pid}`);
let serverModule;
let db;
let gc;
let port;
const users = {};
const SPACE = 'Files';

beforeAll(async () => {
  process.env.PORT = 0;
  process.env.JWT_SECRET = 'disgourd-test-secret-0123456789abcdef';
  process.env.DB_PATH = ':memory:';
  process.env.UPLOADS_DIR = UPLOADS;
  process.env.UPLOAD_QUOTA_BYTES_PER_DAY = '1000';
  serverModule = require('../server');
  db = serverModule.db;
  gc = require('../uploadsGc');
  await new Promise((r) => serverModule.httpServer.listen(0, r));
  port = serverModule.httpServer.address().port;
  for (const name of ['owner', 'ann', 'ben']) {
    const res = await fetch(`http://localhost:${port}/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: name, password: 'gourd-test-pass-1', email: `${name}@example.com` }),
    });
    users[name] = { token: (await res.json()).token, id: db.getUserByUsername(name).id };
  }
  const spaceId = db.createSpaceWithDefaults(SPACE, users.owner.id);
  db.addMember(spaceId, users.ann.id, 'member');
  db.createChannel(SPACE, 'doomed');
});
afterAll((done) => {
  delete process.env.UPLOAD_QUOTA_BYTES_PER_DAY;
  delete process.env.UPLOADS_MAX_TOTAL_BYTES;
  fs.rmSync(UPLOADS, { recursive: true, force: true });
  serverModule.httpServer.close(done);
});

const base = () => `http://localhost:${port}`;
const upload = (who, name, bytes) =>
  fetch(`${base()}/uploads?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${users[who].token}` },
    body: Buffer.alloc(bytes, 65),
  });
const uploadUrl = async (who, name, bytes) => (await (await upload(who, name, bytes)).json()).url;
const status = async (url) => (await fetch(`${base()}${url}`)).status;
const tokenOf = (url) => url.split('/')[2];

describe('quota', () => {
  test('over the daily quota → 429 with a message; someone else can still upload', async () => {
    expect((await upload('ann', 'a.png', 600)).status).toBe(201);
    const over = await upload('ann', 'b.png', 600); // 1,200 > 1,000
    expect(over.status).toBe(429);
    expect((await over.json()).error).toMatch(/uploaded .* today/i);
    expect((await upload('ben', 'c.png', 600)).status).toBe(201);
  });

  test('site admins are exempt', async () => {
    expect((await upload('owner', 'big.png', 900)).status).toBe(201);
    expect((await upload('owner', 'big2.png', 900)).status).toBe(201);
  });

  test('the total cap (UPLOADS_MAX_TOTAL_BYTES) refuses with 507 once reached', async () => {
    process.env.UPLOADS_MAX_TOTAL_BYTES = '1';
    const res = await upload('owner', 'more.png', 10);
    expect(res.status).toBe(507);
    expect((await res.json()).error).toMatch(/full/i);
    delete process.env.UPLOADS_MAX_TOTAL_BYTES;
  });
});

describe('cleanup', () => {
  beforeAll(() => {
    process.env.UPLOAD_QUOTA_BYTES_PER_DAY = String(10 * 1024 * 1024);
  });

  test('deleting the message removes its file; a file another message uses stays', async () => {
    const lone = await uploadUrl('ann', 'lone.png', 10);
    const shared = await uploadUrl('ann', 'shared.png', 10);
    const m1 = db.storeMessage(SPACE, 'general', '', users.ann.id, [lone, shared]).id;
    db.storeMessage(SPACE, 'general', 'again', users.ann.id, [shared]);
    expect(await status(lone)).toBe(200);
    db.deleteMessageById(m1);
    await gc.processQueue();
    expect(await status(lone)).toBe(404);
    expect(fs.existsSync(path.join(UPLOADS, tokenOf(lone)))).toBe(false);
    expect(await status(shared)).toBe(200);
  });

  test('a DM deleted by its author takes its file along', async () => {
    const pic = await uploadUrl('ann', 'dm.png', 10);
    const conv = db.getOrCreatePair(users.ann.id, users.ben.id);
    const dm = db.storeConversationDm(conv, users.ann.id, '', [pic]);
    expect(db.deleteDm(dm.id, users.ann.id)).toBe(true);
    await gc.processQueue();
    expect(await status(pic)).toBe(404);
  });

  test('deleting a channel removes the files of its messages', async () => {
    const pic = await uploadUrl('ann', 'chan.png', 10);
    db.storeMessage(SPACE, 'doomed', '', users.ann.id, [pic]);
    db.deleteChannel(SPACE, 'doomed');
    await gc.processQueue();
    expect(await status(pic)).toBe(404);
  });

  test('an avatar, server icon or emoji is never removed while in use', async () => {
    const avatar = await uploadUrl('ann', 'face.png', 10);
    const icon = await uploadUrl('owner', 'icon.png', 10);
    const emoji = await uploadUrl('owner', 'gourd.png', 10);
    db.setUserAvatar(users.ann.id, avatar, null, null);
    const space = db.getSpaceByName(SPACE);
    db.setSpaceIcon(space.id, icon, null, null);
    db.addSpaceEmoji(space.id, 'gourd', emoji, users.owner.id);
    const m = db.storeMessage(SPACE, 'general', '', users.ann.id, [avatar, icon, emoji]).id;
    db.deleteMessageById(m);
    await gc.processQueue();
    for (const u of [avatar, icon, emoji]) expect(await status(u)).toBe(200);
  });
});

describe('the daily sweep', () => {
  const makeFolder = (token, ageMs) => {
    const dir = path.join(UPLOADS, token);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'x.png'), 'x');
    const t = new Date(Date.now() - ageMs);
    fs.utimesSync(dir, t, t);
    return dir;
  };

  test('removes unreferenced folders older than a day; keeps fresh, referenced and special ones', async () => {
    const old = makeFolder('aaaaaaaaaaaaaaaaaa', 2 * 86400e3);
    const fresh = makeFolder('bbbbbbbbbbbbbbbbbb', 60e3);
    const usedUrl = await uploadUrl('ann', 'used.png', 10);
    db.storeMessage(SPACE, 'general', '', users.ann.id, [usedUrl]);
    const used = path.join(UPLOADS, tokenOf(usedUrl));
    const t = new Date(Date.now() - 2 * 86400e3);
    fs.utimesSync(used, t, t);
    const previews = path.join(UPLOADS, '.previews');
    fs.mkdirSync(previews, { recursive: true });
    fs.utimesSync(previews, t, t);
    const out = await gc.sweep();
    expect(out.removed).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(old)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);
    expect(fs.existsSync(used)).toBe(true);
    expect(fs.existsSync(previews)).toBe(true);
  });
});

test('files are served sandboxed and cached privately', async () => {
  const url = await uploadUrl('ann', 'served.png', 10);
  const res = await fetch(`${base()}${url}`);
  expect(res.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
  expect(res.headers.get('cross-origin-resource-policy')).toBe('same-origin');
  expect(res.headers.get('cache-control')).toBe('private, max-age=86400');
  expect(res.headers.get('x-content-type-options')).toBe('nosniff');
});
