// P2-12: link previews end to end — a message with a URL gets an embed card,
// sent only to people who can see the message, kept in history, cached, and
// never fetched from a private address.
const http = require('http');
const WebSocket = require('ws');
const os = require('os');
const path = require('path');

let serverModule;
let port;
let previews;
let fixture; // a local "website" the previews are fetched from
let site;
const fixtureHits = [];

const PAGE = (title) => `<html><head>
  <title>${title}</title>
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="About ${title}">
  <meta property="og:image" content="/card.png">
  <meta property="og:site_name" content="Fixture">
</head></html>`;

beforeAll((done) => {
  process.env.PORT = 0;
  process.env.JWT_SECRET = 'disgourd-test-secret-0123456789abcdef';
  process.env.DB_PATH = ':memory:';
  process.env.UPLOADS_DIR = path.join(os.tmpdir(), `disgourd-test-uploads-lp-${process.pid}`);
  process.env.LINK_PREVIEWS_ALLOW_LOOPBACK = '1'; // only honoured under NODE_ENV=test
  serverModule = require('../server');
  previews = require('../linkPreviews');
  fixture = http.createServer((req, res) => {
    fixtureHits.push(req.url);
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(PAGE(`Page ${req.url.slice(1)}`));
  });
  fixture.listen(0, '127.0.0.1', () => {
    site = `http://127.0.0.1:${fixture.address().port}`;
    serverModule.httpServer.listen(0, () => {
      port = serverModule.httpServer.address().port;
      done();
    });
  });
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const base = () => `http://localhost:${port}`;

async function register(username) {
  const res = await fetch(`${base()}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'password123', email: `${username}@example.com` }),
  });
  return (await res.json()).token;
}

function gateway(token) {
  const ws = new WebSocket(`ws://localhost:${port}/gateway?token=${token}`);
  const frames = [];
  ws.on('message', (raw) => frames.push(JSON.parse(raw.toString())));
  const ready = new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });
  return { frames, ready, send: (obj) => ws.send(JSON.stringify(obj)), close: () => ws.close() };
}

const users = {};

afterAll((done) => {
  for (const u of Object.values(users)) u.gw?.close();
  fixture.close();
  serverModule.httpServer.close(done);
});

beforeAll(async () => {
  const { db } = serverModule;
  for (const name of ['owner', 'member', 'outsider']) {
    const token = await register(name);
    users[name] = { token, id: db.getUserByUsername(name).id };
  }
  const spaceId = db.createSpaceWithDefaults('Linkland', users.owner.id);
  db.addMember(spaceId, users.member.id, 'member');
  db.createChannel('Linkland', 'owners-only');
  db.setChannelPerms('Linkland', 'owners-only', 3, 3);
  for (const u of Object.values(users)) {
    u.gw = gateway(u.token);
    await u.gw.ready;
  }
  await wait(100);
});

// Send, let the gateway handle it, wait for any previews, let frames land.
async function settle() {
  await wait(80);
  await previews.idle();
  await wait(80);
}
const embedFrames = (who, type = 'message_embeds') => users[who].gw.frames.filter((f) => f.type === type);
const lastMessageId = (channel = 'general') => serverModule.db.getMessages('Linkland', channel, 1).at(-1).id;
const auth = (who) => ({ Authorization: `Bearer ${users[who].token}` });

describe('picking URLs out of a message', () => {
  test('the same rules as the chat autolinks, with opt-outs', () => {
    const { extractUrls } = previews; // loaded in beforeAll, after DB_PATH is set
    expect(extractUrls('see https://a.example/x, and (https://b.example/y).')).toEqual(['https://a.example/x', 'https://b.example/y']);
    expect(extractUrls('quiet <https://a.example/> please')).toEqual([]);
    expect(extractUrls('||https://spoiler.example/|| and `https://code.example/`')).toEqual([]);
    expect(extractUrls('```\nhttps://block.example/\n```')).toEqual([]);
    expect(extractUrls('https://a.example/ https://a.example/ https://b.example https://c.example https://d.example')).toEqual([
      'https://a.example/', 'https://b.example', 'https://c.example',
    ]);
    expect(extractUrls('ftp://no.example javascript:alert(1) xhttps://glued.example')).toEqual([]);
  });
});

test('a message with a link gets a card for everyone who can see it, and history keeps it', async () => {
  users.owner.gw.send({ op: 'message', space: 'Linkland', channel: 'general', content: `look ${site}/one` });
  await settle();
  const id = lastMessageId();
  for (const who of ['owner', 'member']) {
    const f = embedFrames(who).find((x) => Number(x.id) === Number(id));
    expect(f).toMatchObject({ space: 'Linkland', channel: 'general' });
    expect(f.embeds).toEqual([
      expect.objectContaining({ title: 'Page one', description: 'About Page one', siteName: 'Fixture', image: `${site}/card.png` }),
    ]);
  }
  expect(embedFrames('outsider')).toEqual([]); // not a member

  const res = await fetch(`${base()}/spaces/Linkland/channels/general/messages`, { headers: auth('member') });
  const msg = (await res.json()).find((m) => Number(m.id) === Number(id));
  expect(msg.embeds).toEqual([expect.objectContaining({ title: 'Page one' })]);
});

test('a private channel\'s card only goes to people who can see the channel', async () => {
  const before = embedFrames('member').length;
  users.owner.gw.send({ op: 'message', space: 'Linkland', channel: 'owners-only', content: `${site}/secret` });
  await settle();
  const id = lastMessageId('owners-only');
  expect(embedFrames('owner').some((f) => Number(f.id) === Number(id))).toBe(true);
  expect(embedFrames('member').length).toBe(before);
});

test('the same link again is served from the cache, without fetching', async () => {
  const hits = fixtureHits.length;
  users.member.gw.send({ op: 'message', space: 'Linkland', channel: 'general', content: `again ${site}/one` });
  await settle();
  expect(fixtureHits.length).toBe(hits);
  const id = lastMessageId();
  expect(embedFrames('owner').find((f) => Number(f.id) === Number(id)).embeds[0].title).toBe('Page one');
});

test('a link to a private address gets no card and makes no request at all', async () => {
  const spy = jest.spyOn(http, 'request');
  try {
    const before = embedFrames('owner').length;
    users.owner.gw.send({ op: 'message', space: 'Linkland', channel: 'general', content: 'http://10.0.0.1/admin http://169.254.169.254/latest/' });
    await settle();
    expect(spy).not.toHaveBeenCalled();
    expect(embedFrames('owner').length).toBe(before);
  } finally {
    spy.mockRestore();
  }
});

test('with previews switched off, nothing is fetched', async () => {
  const { db } = serverModule;
  db.setSetting('link_previews', 'off');
  try {
    const hits = fixtureHits.length;
    const before = embedFrames('owner').length;
    users.owner.gw.send({ op: 'message', space: 'Linkland', channel: 'general', content: `${site}/while-off` });
    await settle();
    expect(fixtureHits.length).toBe(hits);
    expect(embedFrames('owner').length).toBe(before);
  } finally {
    db.setSetting('link_previews', 'on');
  }
});

test('editing a link away removes its card; deleting the message drops its embeds', async () => {
  users.owner.gw.send({ op: 'message', space: 'Linkland', channel: 'general', content: `edit me ${site}/two` });
  await settle();
  const id = lastMessageId();
  expect(serverModule.db.getEmbedUrls('channel', id)).toEqual([`${site}/two`]);

  users.owner.gw.send({ op: 'edit', id, content: 'no link any more' });
  await settle();
  expect(embedFrames('member').filter((f) => Number(f.id) === Number(id)).at(-1).embeds).toEqual([]);
  expect(serverModule.db.getEmbedUrls('channel', id)).toEqual([]);

  users.owner.gw.send({ op: 'edit', id, content: `back again ${site}/two` });
  await settle();
  expect(serverModule.db.getEmbedUrls('channel', id)).toEqual([`${site}/two`]);
  users.owner.gw.send({ op: 'delete', id });
  await settle();
  expect(serverModule.db.getEmbedUrls('channel', id)).toEqual([]); // cascade
});

test('direct messages get cards too, for both people only', async () => {
  users.owner.gw.send({ op: 'dm', to: 'member', content: `dm link ${site}/dm` });
  await settle();
  const owner = embedFrames('owner', 'dm_embeds').at(-1);
  const member = embedFrames('member', 'dm_embeds').at(-1);
  expect(owner.embeds[0].title).toBe('Page dm');
  expect(member.id).toBe(owner.id);
  expect(embedFrames('outsider', 'dm_embeds')).toEqual([]);

  const res = await fetch(`${base()}/dms/owner/messages`, { headers: auth('member') });
  const msg = (await res.json()).find((m) => Number(m.id) === Number(owner.id));
  expect(msg.embeds).toEqual([expect.objectContaining({ title: 'Page dm' })]);
});

test('site admins can switch previews off and on; others cannot', async () => {
  const put = (who, enabled) =>
    fetch(`${base()}/admin/link-previews`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...auth(who) },
      body: JSON.stringify({ enabled }),
    });
  expect((await put('member', false)).status).toBe(403);
  expect((await put('owner', false)).status).toBe(200); // the first account is the site admin
  let info = await (await fetch(`${base()}/admin/registration`, { headers: auth('owner') })).json();
  expect(info.linkPreviews).toBe(false);
  expect(previews.enabled()).toBe(false);
  await put('owner', true);
  info = await (await fetch(`${base()}/admin/registration`, { headers: auth('owner') })).json();
  expect(info.linkPreviews).toBe(true);
});
