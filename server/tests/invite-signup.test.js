// P14-01: one invite link. A server invite also creates the account (by the
// site's policy) and joins its server in the same step; the modes Open /
// Invite only / Closed (+ "Invite links still let people sign up"); "who can
// bring in new people"; a public preview; easy invite codes.
const os = require('os');
const path = require('path');

const PASS = 'gourd-test-pass-1';
let serverModule;
let port;
let db;
let owner; // the site admin (first account), owner of "Den"
let sam; // a regular user who owns "Sams Place"
let mia; // a regular member of "Sams Place"

beforeAll(async () => {
  process.env.PORT = 0;
  process.env.JWT_SECRET = 'disgourd-test-secret-0123456789abcdef';
  process.env.DB_PATH = ':memory:';
  process.env.UPLOADS_DIR = path.join(os.tmpdir(), `disgourd-test-uploads-invsignup-${process.pid}`);
  serverModule = require('../server');
  db = serverModule.db;
  await new Promise((r) => serverModule.httpServer.listen(0, r));
  port = serverModule.httpServer.address().port;
  owner = (await register('owner')).body.token;
  sam = (await register('sam')).body.token;
  mia = (await register('mia')).body.token;
  await call(owner, 'POST', '/spaces', { name: 'Den' });
  await call(sam, 'POST', '/spaces', { name: 'Sams Place' });
  await call(mia, 'POST', `/invites/${await invite(sam, 'Sams Place')}`);
});
afterAll((done) => {
  serverModule.httpServer.close(done);
});

const base = () => `http://localhost:${port}`;
const call = (token, method, p, body) => fetch(`${base()}${p}`, {
  method,
  headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
});
const json = async (res) => ({ status: res.status, body: await res.json() });
async function register(username, extra = {}) {
  return json(await call(null, 'POST', '/register', { username, password: PASS, ...extra }));
}
async function invite(token, space, opts = {}) {
  const r = await json(await call(token, 'POST', `/spaces/${encodeURIComponent(space)}/invites`, opts));
  if (r.status !== 201) throw new Error(`invite failed: ${JSON.stringify(r)}`);
  return r.body.code;
}
const setPolicy = (body) => call(owner, 'PUT', '/admin/registration', body);
const memberOf = (username, space) => db.isMember(db.getSpaceByName(space).id, db.getUserByUsername(username).id);
const usesOf = (code) => db.getInvite(code).uses;
let n = 0;
const fresh = () => `newbie${++n}`;

test('Invite only, site admins only (the default): the site admin’s invite signs up and joins in one step; others’ invites don’t', async () => {
  expect(await json(await setPolicy({ mode: 'invite' }))).toMatchObject({ status: 200, body: { mode: 'invite', invitesCreateAccounts: 'site_admins', closedAllowsInvites: false } });
  const code = await invite(owner, 'Den');
  expect(code).toMatch(/^[A-HJKMNP-Z2-9]{5}-[A-HJKMNP-Z2-9]{5}$/); // easy to type
  const name = fresh();
  const r = await register(name, { invite: code });
  expect(r).toMatchObject({ status: 201, body: { joined: 'Den' } });
  expect(r.body.token).toBeTruthy();
  expect(memberOf(name, 'Den')).toBe(true);
  expect(usesOf(code)).toBe(1);
  // No code field needed; a sign-up code would still work on its own.
  // A regular server owner's invite can't create accounts under this policy.
  const samCode = await invite(sam, 'Sams Place');
  const refused = await register(fresh(), { invite: samCode });
  expect(refused).toEqual({ status: 403, body: { error: 'This invite can’t be used to create an account here. Ask the server’s admins, or sign in if you already have an account.' } });
  expect(usesOf(samCode)).toBe(0);
  // ...but it still lets someone who has an account join.
  expect((await call(owner, 'POST', `/invites/${samCode}`)).status).toBe(200);
});

test('"server_admins" and "inviters", judged on the creator as they are now', async () => {
  await setPolicy({ mode: 'invite', invitesCreateAccounts: 'server_admins' });
  const samCode = await invite(sam, 'Sams Place');
  const miaCode = await invite(mia, 'Sams Place'); // members can invite by default
  expect((await register(fresh(), { invite: samCode })).status).toBe(201); // the server's owner
  expect((await register(fresh(), { invite: miaCode })).status).toBe(403); // just a member
  await setPolicy({ invitesCreateAccounts: 'inviters' });
  expect((await register(fresh(), { invite: miaCode })).status).toBe(201);
  // A site admin who is demoted: their links stop creating accounts at once.
  await setPolicy({ invitesCreateAccounts: 'site_admins' });
  db.setSiteAdmin(db.getUserByUsername('sam').id, true);
  const asAdmin = await invite(sam, 'Sams Place');
  expect((await json(await call(null, 'GET', `/invites/${asAdmin}/preview`))).body.signUp).toBe(true);
  db.setSiteAdmin(db.getUserByUsername('sam').id, false);
  expect((await json(await call(null, 'GET', `/invites/${asAdmin}/preview`))).body.signUp).toBe(false);
  expect((await register(fresh(), { invite: asAdmin })).status).toBe(403);
  // A suspended creator's links stop too.
  await setPolicy({ invitesCreateAccounts: 'inviters' });
  db.raw.prepare('UPDATE users SET suspended_at = ? WHERE username = ?').run(Date.now(), 'mia');
  expect((await register(fresh(), { invite: miaCode })).status).toBe(403);
  db.raw.prepare('UPDATE users SET suspended_at = NULL WHERE username = ?').run('mia');
  await setPolicy({ invitesCreateAccounts: 'site_admins' });
});

test('Closed refuses everyone unless "Invite links still let people sign up"; Open always works and still joins', async () => {
  const code = await invite(owner, 'Den');
  await setPolicy({ mode: 'closed' });
  expect((await register(fresh())).body.error).toBe('Registration is closed on this server.');
  expect((await register(fresh(), { invite: code })).status).toBe(403);
  await setPolicy({ closedAllowsInvites: true });
  expect((await json(await call(null, 'GET', '/auth-info'))).body).toMatchObject({ registration: 'closed', closedAllowsInvites: true });
  expect((await register(fresh(), { invite: code })).status).toBe(201);
  expect((await register(fresh())).status).toBe(403); // still no sign-up without one
  await setPolicy({ mode: 'open', closedAllowsInvites: false });
  const samCode = await invite(sam, 'Sams Place');
  const name = fresh();
  expect(await register(name, { invite: samCode })).toMatchObject({ status: 201, body: { joined: 'Sams Place' } }); // any invite joins in Open
  expect(memberOf(name, 'Sams Place')).toBe(true);
  expect((await register(fresh())).status).toBe(201); // and no invite is needed
  await setPolicy({ mode: 'invite' });
});

test('a used-up, expired or unknown invite fails before any account is made, and a race inside the transaction rolls back', async () => {
  const before = db.countUsers();
  const once = await invite(owner, 'Den', { maxUses: 1 });
  expect((await register(fresh(), { invite: once })).status).toBe(201);
  expect(await register(fresh(), { invite: once })).toEqual({ status: 410, body: { error: 'This invite has been fully used' } });
  const old = await invite(owner, 'Den');
  db.raw.prepare('UPDATE invites SET expires_at = ? WHERE code = ?').run(Date.now() - 1, old);
  expect(await register(fresh(), { invite: old })).toEqual({ status: 410, body: { error: 'This invite has expired' } });
  expect(await register(fresh(), { invite: 'NOPE2-NOPE3' })).toEqual({ status: 404, body: { error: 'This invite is invalid or has expired' } });
  expect(db.countUsers()).toBe(before + 1);
  // Used up between the checks and the insert: nothing is created.
  const race = await invite(owner, 'Den', { maxUses: 1 });
  db.raw.prepare('UPDATE invites SET uses = 1 WHERE code = ?').run(race);
  expect(db.createUserRedeemingCode({ username: 'racer', email: null, passwordHash: 'h', salt: 's', regCodeId: null, maxAccounts: 0, inviteCode: race })).toEqual({ error: 'invite-exhausted' });
  expect(db.getUserByUsername('racer')).toBeUndefined();
});

test('the public preview: only what it should say, the same 404 for anything else, rate-limited', async () => {
  const code = await invite(owner, 'Den');
  const p = await json(await call(null, 'GET', `/invites/${code}/preview`));
  expect(p.status).toBe(200);
  expect(Object.keys(p.body).sort()).toEqual(['icon', 'inviter', 'members', 'signUp', 'space']);
  expect(p.body).toMatchObject({ space: 'Den', inviter: 'owner', signUp: true });
  expect(p.body.members).toBeGreaterThan(0);
  const used = await invite(owner, 'Den', { maxUses: 1 });
  db.raw.prepare('UPDATE invites SET uses = 1 WHERE code = ?').run(used);
  for (const bad of ['NOPE2-NOPE3', used]) {
    expect(await json(await call(null, 'GET', `/invites/${bad}/preview`))).toEqual({ status: 404, body: { error: 'This invite is invalid or has expired' } });
  }
  serverModule.config.rateLimit = true;
  try {
    let last;
    for (let i = 0; i < 31; i++) last = await call(null, 'GET', `/invites/${code}/preview`);
    expect(last.status).toBe(429);
  } finally {
    serverModule.config.rateLimit = false;
    require('../auth/rateLimit')._reset();
  }
});

test('invite codes match however they are typed; old-style codes still work', async () => {
  const code = await invite(owner, 'Den');
  const typed = ` ${code.toLowerCase().replace('-', ' ')} `;
  expect((await json(await call(null, 'GET', `/invites/${encodeURIComponent(typed)}/preview`))).body.space).toBe('Den');
  const name = fresh();
  expect((await register(name, { invite: code.replace('-', '').toLowerCase() })).body.joined).toBe('Den');
  // A pre-P14 code (mixed case, dash and underscore) keeps working, exactly or not.
  db.createInvite('aB3x-Q9_kZ1m', db.getSpaceByName('Den').id, db.getUserByUsername('owner').id);
  expect((await json(await call(null, 'GET', '/invites/aB3x-Q9_kZ1m/preview'))).body.space).toBe('Den');
  expect((await json(await call(null, 'GET', '/invites/AB3XQ9_KZ1M/preview'))).body.space).toBe('Den');
  const joiner = (await register(fresh(), { invite: 'aB3x-Q9_kZ1m' }));
  expect(joiner.body.joined).toBe('Den');
});

test('the old "code" mode reads as "invite", and the admin settings validate', async () => {
  db.setSetting('registration_mode', 'code');
  expect((await json(await call(null, 'GET', '/auth-info'))).body.registration).toBe('invite');
  expect((await json(await setPolicy({ mode: 'code' }))).body.mode).toBe('invite');
  expect(db.getSetting('registration_mode')).toBe('invite');
  expect((await setPolicy({ mode: 'sometimes' })).status).toBe(400);
  expect((await setPolicy({ invitesCreateAccounts: 'everyone' })).status).toBe(400);
  expect((await setPolicy({ closedAllowsInvites: 'yes' })).status).toBe(400);
  expect((await call(sam, 'PUT', '/admin/registration', { mode: 'open' })).status).toBe(403);
  expect((await json(await call(owner, 'GET', '/admin/registration'))).body).toMatchObject({ mode: 'invite', closedAllowsInvites: false, invitesCreateAccounts: 'site_admins' });
});
