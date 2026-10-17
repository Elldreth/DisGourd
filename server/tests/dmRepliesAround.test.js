// P2-10: replies in DMs, and the `around` history window used to jump to a
// message that isn't loaded (channels and DMs).
const WebSocket = require('ws');
const os = require('os');
const path = require('path');

let serverModule;
let port;
const users = {}; // name -> { token, id, gw, frames }

beforeAll((done) => {
  process.env.PORT = 0;
  process.env.JWT_SECRET = 'disgourd-test-secret-0123456789abcdef';
  process.env.DB_PATH = ':memory:';
  process.env.UPLOADS_DIR = path.join(os.tmpdir(), `disgourd-test-uploads-around-${process.pid}`);
  serverModule = require('../server');
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
const base = () => `http://localhost:${port}`;
const get = (who, p) => fetch(`${base()}${p}`, { headers: { Authorization: `Bearer ${users[who].token}` } });

async function register(username) {
  const res = await fetch(`${base()}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'password123', email: `${username}@example.com` }),
  });
  return (await res.json()).token;
}

const ids = {}; // seeded message ids
beforeAll(async () => {
  const { db } = serverModule;
  for (const name of ['ann', 'ben', 'cat']) {
    const token = await register(name);
    users[name] = { token, id: db.getUserByUsername(name).id, frames: [] };
  }
  const spaceId = db.createSpaceWithDefaults('Hist', users.ann.id);
  db.addMember(spaceId, users.ben.id, 'member');
  db.createChannel('Hist', 'other');
  db.createChannel('Hist', 'mods');
  db.setChannelPerms('Hist', 'mods', 2, 2); // admins and up
  ids.general = [];
  for (let i = 1; i <= 120; i++) ids.general.push(db.storeMessage('Hist', 'general', `g${i}`, users.ann.id).id);
  ids.other = db.storeMessage('Hist', 'other', 'elsewhere', users.ann.id).id;
  ids.mods = db.storeMessage('Hist', 'mods', 'secret', users.ann.id).id;
  ids.dm = [];
  for (let i = 1; i <= 80; i++) ids.dm.push(db.storeDm(i % 2 ? users.ann.id : users.ben.id, i % 2 ? users.ben.id : users.ann.id, `d${i}`).id);
  ids.otherPair = db.storeDm(users.ann.id, users.cat.id, 'ann to cat').id;

  for (const u of Object.values(users)) {
    u.gw = new WebSocket(`ws://localhost:${port}/gateway?token=${u.token}`);
    u.gw.on('message', (raw) => u.frames.push(JSON.parse(raw.toString())));
    await new Promise((r) => u.gw.on('open', r));
  }
  await wait(80);
});

const send = (who, frame) => users[who].gw.send(JSON.stringify(frame));
const lastDm = (who) => users[who].frames.filter((f) => f.type === 'dm').at(-1);

describe('replies in DMs', () => {
  test('a reply carries its quote live and in history', async () => {
    const original = ids.dm[79]; // "d80", from ben
    send('ann', { op: 'dm', to: 'ben', content: 'answering that', replyTo: original });
    await wait(120);
    for (const who of ['ann', 'ben']) {
      expect(lastDm(who).replyTo).toEqual({ id: Number(original), authorId: users.ben.id, author: 'ben', snippet: 'd80' });
    }
    const history = await (await get('ben', '/dms/ann/messages')).json();
    const reply = history.find((m) => Number(m.id) === Number(lastDm('ben').id));
    expect(reply.replyTo).toMatchObject({ id: Number(original), author: 'ben', snippet: 'd80' });
    expect(history.find((m) => m.content === 'd79').replyTo).toBeNull();
  });

  test('a replyTo from another conversation, or one that does not exist here, or garbage is ignored', async () => {
    // (ids are per table: a channel message's number only means "DM #n" here,
    // so the one rule that matters is that the DM must be in this conversation)
    for (const bad of [ids.otherPair, 5000, 'x', -5, 999999]) {
      send('ann', { op: 'dm', to: 'ben', content: `bad ${bad}`, replyTo: bad });
      await wait(60);
      const f = lastDm('ben');
      expect(f.content).toBe(`bad ${bad}`);
      expect(f.replyTo).toBeNull();
    }
    const history = await (await get('ben', '/dms/ann/messages')).json();
    expect(history.filter((m) => m.content.startsWith('bad ')).every((m) => m.replyTo === null)).toBe(true);
  });

  test('a deleted original shows as deleted', async () => {
    const target = serverModule.db.storeDm(users.ben.id, users.ann.id, 'soon gone').id;
    send('ann', { op: 'dm', to: 'ben', content: 'quoting it', replyTo: target });
    await wait(80);
    serverModule.db.deleteDm(target, users.ben.id);
    const history = await (await get('ann', '/dms/ben/messages')).json();
    expect(history.find((m) => m.content === 'quoting it').replyTo).toEqual({ id: Number(target), deleted: true });
  });
});

describe('the around window', () => {
  const contents = (rows) => rows.map((m) => m.content);

  test('channel: 25 before and 25 after the message, oldest first', async () => {
    const target = ids.general[59]; // g60
    const res = await get('ben', `/spaces/Hist/channels/general/messages?around=${target}`);
    expect(res.status).toBe(200);
    const rows = await res.json();
    expect(contents(rows)).toEqual(Array.from({ length: 51 }, (_, i) => `g${35 + i}`));
    expect(rows.some((m) => Number(m.id) === Number(target))).toBe(true);
  });

  test('channel: near the start or the end the window is just shorter', async () => {
    const first = await (await get('ben', `/spaces/Hist/channels/general/messages?around=${ids.general[2]}`)).json();
    expect(contents(first)[0]).toBe('g1');
    expect(first.filter((m) => m.id < ids.general[2])).toHaveLength(2);
    const last = await (await get('ben', `/spaces/Hist/channels/general/messages?around=${ids.general[118]}`)).json();
    expect(contents(last).at(-1)).toBe('g120');
    expect(last.filter((m) => m.id > ids.general[118])).toHaveLength(1);
  });

  test('channel: an id from another channel is 404; a channel you cannot see is 403', async () => {
    expect((await get('ben', `/spaces/Hist/channels/general/messages?around=${ids.other}`)).status).toBe(404);
    expect((await get('ben', `/spaces/Hist/channels/general/messages?around=999999`)).status).toBe(404);
    expect((await get('ben', `/spaces/Hist/channels/mods/messages?around=${ids.mods}`)).status).toBe(403);
    expect((await get('ann', `/spaces/Hist/channels/mods/messages?around=${ids.mods}`)).status).toBe(200);
  });

  test('DM: a window around the message; another conversation\'s id is 404', async () => {
    const target = ids.dm[39]; // d40
    const rows = await (await get('ann', `/dms/ben/messages?around=${target}`)).json();
    expect(contents(rows)).toEqual(Array.from({ length: 51 }, (_, i) => `d${15 + i}`));
    expect((await get('ann', `/dms/ben/messages?around=${ids.otherPair}`)).status).toBe(404);
    expect((await get('cat', `/dms/ben/messages?around=${target}`)).status).toBe(404); // not cat's conversation
  });

  test('after= takes a limit (for loading newer pages after a jump)', async () => {
    const rows = await (await get('ben', `/spaces/Hist/channels/general/messages?after=${ids.general[9]}&limit=50`)).json();
    expect(contents(rows)).toEqual(Array.from({ length: 50 }, (_, i) => `g${11 + i}`));
    const dms = await (await get('ann', `/dms/ben/messages?after=${ids.dm[9]}&limit=20`)).json();
    expect(dms).toHaveLength(20);
    // Without a limit, after= still backfills up to 200 (the reconnect resync).
    expect(await (await get('ben', `/spaces/Hist/channels/general/messages?after=${ids.general[0]}`)).json()).toHaveLength(119);
  });
});
