// P3-20c: removing a message's link cards — who may, what everyone sees, and
// that an edit doesn't bring them back.
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

let serverModule;
let db;
let linkPreviews;
let port;
const users = {};
const SPACE = 'Previews';
const URL1 = 'https://example.com/article';
const CARD = { url: URL1, title: 'An article', description: 'About things', siteName: 'Example', image: null };

beforeAll((done) => {
  process.env.PORT = 0;
  process.env.JWT_SECRET = 'disgourd-test-secret-0123456789abcdef';
  process.env.DB_PATH = ':memory:';
  process.env.UPLOADS_DIR = path.join(os.tmpdir(), `disgourd-test-uploads-hidepreview-${process.pid}`);
  serverModule = require('../server');
  db = serverModule.db;
  linkPreviews = require('../linkPreviews');
  serverModule.httpServer.listen(0, () => {
    port = serverModule.httpServer.address().port;
    done();
  });
});
afterAll((done) => {
  for (const u of Object.values(users)) u.gw?.close();
  serverModule.httpServer.close(done);
});

const call = async (who, method, p) => {
  const res = await fetch(`http://localhost:${port}${p}`, { method, headers: { Authorization: `Bearer ${users[who].token}` } });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const framesOf = (who, type) => users[who].frames.filter((f) => f.type === type);
const withCard = (kind, id) => {
  db.saveLinkPreview(URL1, CARD);
  db.setEmbeds(kind, id, [URL1]);
};

beforeAll(async () => {
  for (const name of ['owner', 'author', 'other', 'outsider']) {
    const res = await fetch(`http://localhost:${port}/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: name, password: 'gourd-test-pass-1', email: `${name}@example.com` }),
    });
    users[name] = { token: (await res.json()).token, id: db.getUserByUsername(name).id, frames: [] };
  }
  const spaceId = db.createSpaceWithDefaults(SPACE, users.owner.id);
  db.addMember(spaceId, users.author.id, 'member');
  db.addMember(spaceId, users.other.id, 'member');
  for (const n of ['author', 'other']) {
    const u = users[n];
    u.gw = new WebSocket(`ws://localhost:${port}/gateway?token=${u.token}`);
    u.gw.on('message', (raw) => u.frames.push(JSON.parse(raw.toString())));
    await new Promise((r) => u.gw.on('open', r));
  }
});

test('channel: the author removes the cards; every viewer gets an empty list; history has none', async () => {
  const msg = db.storeMessage(SPACE, 'general', `read this ${URL1}`, users.author.id);
  const id = Number(msg.id);
  withCard('channel', id);
  expect((await call('other', 'GET', `/spaces/${SPACE}/channels/general/messages`)).body.find((m) => m.id === id).embeds).toHaveLength(1);
  expect((await call('other', 'DELETE', `/spaces/${SPACE}/channels/general/messages/${id}/preview`)).status).toBe(403); // not theirs
  expect((await call('author', 'DELETE', `/spaces/${SPACE}/channels/general/messages/${id}/preview`)).body).toEqual({ ok: true });
  await new Promise((r) => setTimeout(r, 60));
  expect(framesOf('other', 'message_embeds').at(-1)).toMatchObject({ id, space: SPACE, channel: 'general', embeds: [] });
  expect((await call('other', 'GET', `/spaces/${SPACE}/channels/general/messages`)).body.find((m) => m.id === id).embeds).toEqual([]);
  expect(db.embedsHidden('channel', id)).toBe(true);
});

test('channel: a moderator may remove someone else’s cards; wrong channel and outsiders are refused', async () => {
  const id = Number(db.storeMessage(SPACE, 'general', `see ${URL1}`, users.author.id).id);
  withCard('channel', id);
  expect((await call('outsider', 'DELETE', `/spaces/${SPACE}/channels/general/messages/${id}/preview`)).status).toBe(403);
  db.createChannel(SPACE, 'other-room');
  expect((await call('owner', 'DELETE', `/spaces/${SPACE}/channels/other-room/messages/${id}/preview`)).status).toBe(404);
  expect((await call('owner', 'DELETE', `/spaces/${SPACE}/channels/general/messages/999999/preview`)).status).toBe(404);
  expect((await call('owner', 'DELETE', `/spaces/${SPACE}/channels/general/messages/${id}/preview`)).body).toEqual({ ok: true });
  expect(db.getEmbedUrls('channel', id)).toEqual([]);
});

test('an edit does not bring removed cards back', async () => {
  const id = Number(db.storeMessage(SPACE, 'general', `again ${URL1}`, users.author.id).id);
  withCard('channel', id);
  db.hideEmbeds('channel', id);
  db.setSetting('link_previews', 'on');
  const deliver = jest.fn();
  linkPreviews.handleMessage({ kind: 'channel', messageId: id, content: `edited ${URL1}`, userId: users.author.id, deliver, edited: true });
  await linkPreviews.idle?.();
  await new Promise((r) => setTimeout(r, 30));
  expect(deliver).not.toHaveBeenCalled();
  expect(db.getEmbedUrls('channel', id)).toEqual([]);
});

test('DMs: the author removes the cards and both people are told; the partner and strangers can’t', async () => {
  const dm = db.storeDm(users.author.id, users.other.id, `look ${URL1}`);
  const id = Number(dm.id);
  withCard('dm', id);
  expect((await call('other', 'DELETE', `/dms/author/messages/${id}/preview`)).status).toBe(403); // the partner, not the author
  expect((await call('outsider', 'DELETE', `/dms/author/messages/${id}/preview`)).status).toBe(404);
  expect((await call('author', 'DELETE', `/dms/other/messages/${id}/preview`)).body).toEqual({ ok: true });
  await new Promise((r) => setTimeout(r, 60));
  expect(framesOf('other', 'dm_embeds').at(-1)).toEqual({ type: 'dm_embeds', id, conversation: expect.any(Number), embeds: [] });
  expect(framesOf('author', 'dm_embeds').at(-1)).toEqual({ type: 'dm_embeds', id, conversation: expect.any(Number), embeds: [] });
  expect(db.getEmbedUrls('dm', id)).toEqual([]);
});
