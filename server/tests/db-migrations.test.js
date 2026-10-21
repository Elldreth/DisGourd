// P1-01: versioned migrations, connection pragmas and hot-path indexes.
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { MIGRATIONS, LATEST_VERSION, runMigrations } = require('../db/migrations');

let tmp;
const savedDbPath = process.env.DB_PATH;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'disgourd-migrate-test-'));
  jest.resetModules();
});

afterEach(() => {
  process.env.DB_PATH = savedDbPath;
  fs.rmSync(tmp, { recursive: true, force: true });
});

// Load the db module against a given file, the way the server does at boot.
function bootDb(file) {
  process.env.DB_PATH = file;
  return require('../db');
}

const indexNames = (raw) =>
  raw.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%'").all().map((r) => r.name);

test('a fresh database ends at the latest version with the hot-path indexes', () => {
  const db = bootDb(':memory:');
  expect(LATEST_VERSION).toBe(MIGRATIONS[MIGRATIONS.length - 1].version);
  expect(db.raw.pragma('user_version', { simple: true })).toBe(LATEST_VERSION);
  expect(indexNames(db.raw).sort()).toEqual(['idx_categories_space', 'idx_dm_conversation', 'idx_dm_pair', 'idx_dm_participants_user', 'idx_imagine_jobs_message', 'idx_imagine_jobs_user', 'idx_member_roles_member', 'idx_mentions_user', 'idx_messages_channel', 'idx_pins_channel', 'idx_push_user', 'idx_roles_space', 'idx_thread_follows_channel', 'idx_threads_parent', 'idx_threads_root', 'idx_uploads_user_time', 'idx_user_blocks_blocked']);
});

test('connection pragmas: busy_timeout 5000, synchronous NORMAL, foreign keys on', () => {
  const db = bootDb(path.join(tmp, 'p.db'));
  expect(db.raw.pragma('busy_timeout', { simple: true })).toBe(5000);
  expect(db.raw.pragma('synchronous', { simple: true })).toBe(1);
  expect(db.raw.pragma('foreign_keys', { simple: true })).toBe(1);
  db.raw.close();
});

test('a legacy database with the original minimal schema upgrades in place', () => {
  const file = path.join(tmp, 'legacy.db');
  const legacy = new Database(file);
  legacy.exec(`
    CREATE TABLE spaces (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL);
    CREATE TABLE channels (id INTEGER PRIMARY KEY AUTOINCREMENT, space_id INTEGER NOT NULL, name TEXT NOT NULL,
      UNIQUE(space_id, name));
    CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, channel_id INTEGER NOT NULL, content TEXT NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL, salt TEXT NOT NULL);
    INSERT INTO spaces(name) VALUES ('Old Server');
    INSERT INTO channels(space_id, name) VALUES (1, 'general');
    INSERT INTO messages(channel_id, content, timestamp) VALUES (1, 'hello from 2025', '2025-06-01 12:00:00');
    INSERT INTO users(username, password_hash, salt) VALUES ('veteran', 'h', 's');
  `);
  expect(legacy.pragma('user_version', { simple: true })).toBe(0);
  legacy.close();

  const db = bootDb(file);
  expect(db.raw.pragma('user_version', { simple: true })).toBe(LATEST_VERSION);
  const cols = (t) => db.raw.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
  expect(cols('messages')).toEqual(expect.arrayContaining(['author_id', 'created_at', 'attachments', 'attachment_spoiler', 'edited_at']));
  expect(cols('channels')).toEqual(expect.arrayContaining(['type', 'view_role', 'post_role']));
  expect(cols('users')).toEqual(expect.arrayContaining(['email', 'avatar_url', 'site_admin']));
  const msg = db.raw.prepare('SELECT content, created_at FROM messages').get();
  expect(msg.content).toBe('hello from 2025');
  expect(msg.created_at).toBe(Date.UTC(2025, 5, 1, 12, 0, 0));
  expect(db.getMessages('Old Server', 'general', 10, 0).map((m) => m.content)).toEqual(['hello from 2025']);
  // The per-boot bootstrap still promotes the earliest user to site admin.
  expect(db.isSiteAdmin(db.getUserByUsername('veteran').id)).toBe(true);
  db.raw.close();
});

test('booting twice is a no-op', () => {
  const file = path.join(tmp, 'twice.db');
  const first = bootDb(file);
  first.createUser('a', 'a@example.com', 'h', 's');
  first.raw.close();
  jest.resetModules();
  const second = bootDb(file);
  expect(second.raw.pragma('user_version', { simple: true })).toBe(LATEST_VERSION);
  expect(second.countUsers()).toBe(1);
  second.raw.close();
});

test('a failing migration aborts with a clear error and leaves the version unchanged', () => {
  const raw = new Database(':memory:');
  runMigrations(raw);
  const broken = [
    ...MIGRATIONS,
    {
      version: LATEST_VERSION + 1,
      name: 'broken on purpose',
      up(db) {
        db.exec('CREATE TABLE half_done (id INTEGER)');
        throw new Error('boom');
      },
    },
  ];
  expect(() => runMigrations(raw, broken)).toThrow(
    new RegExp(`migration ${LATEST_VERSION + 1} \\(broken on purpose\\) failed: boom`, 'i')
  );
  expect(raw.pragma('user_version', { simple: true })).toBe(LATEST_VERSION);
  // Rolled back: the table created before the throw is gone.
  expect(raw.prepare("SELECT name FROM sqlite_master WHERE name = 'half_done'").get()).toBeUndefined();
});

test('the channel history query uses idx_messages_channel', () => {
  const db = bootDb(':memory:');
  const plan = db.raw.prepare(`EXPLAIN QUERY PLAN
    SELECT m.id FROM messages m
    JOIN channels c ON m.channel_id = c.id
    JOIN spaces s ON c.space_id = s.id
    WHERE s.name = ? AND c.name = ?
    ORDER BY m.id DESC LIMIT 50`).all('x', 'y').map((r) => r.detail).join('\n');
  expect(plan).toMatch(/idx_messages_channel/);
});

test('v21 gives existing seeded Admin roles "Ban members", and leaves other roles alone', () => {
  const raw = new Database(':memory:');
  runMigrations(raw, MIGRATIONS.filter((m) => m.version < 21));
  raw.prepare("INSERT INTO users(id, username, email, password_hash, salt) VALUES (1, 'o', 'o@x', 'h', 's')").run();
  raw.prepare("INSERT INTO spaces(id, name, owner_id) VALUES (1, 'S', 1)").run();
  const add = raw.prepare('INSERT INTO roles(space_id, name, color, position, permissions, is_default, created_at) VALUES (1, ?, NULL, ?, ?, ?, 0)');
  add.run('@everyone', 0, '["invite"]', 1);
  add.run('Admin', 2, '["kick","pin_messages"]', 0);
  add.run('Helpers', 1, '["pin_messages"]', 0);
  runMigrations(raw, MIGRATIONS.filter((m) => m.version <= 21));
  const perms = (name) => JSON.parse(raw.prepare('SELECT permissions FROM roles WHERE name = ?').get(name).permissions);
  expect(perms('Admin')).toEqual(['kick', 'pin_messages', 'ban_members']);
  expect(perms('Helpers')).toEqual(['pin_messages']);
  expect(perms('@everyone')).toEqual(['invite']);
});

test('v22 adds timeout columns and gives existing seeded Admin roles "Time out members"', () => {
  const raw = new Database(':memory:');
  runMigrations(raw, MIGRATIONS.filter((m) => m.version < 22));
  raw.prepare("INSERT INTO users(id, username, email, password_hash, salt) VALUES (1, 'o', 'o@x', 'h', 's')").run();
  raw.prepare("INSERT INTO spaces(id, name, owner_id) VALUES (1, 'S', 1)").run();
  const add = raw.prepare('INSERT INTO roles(space_id, name, color, position, permissions, is_default, created_at) VALUES (1, ?, NULL, ?, ?, ?, 0)');
  add.run('Admin', 2, '["kick","ban_members"]', 0);
  add.run('Helpers', 1, '["pin_messages"]', 0);
  runMigrations(raw);
  const perms = (name) => JSON.parse(raw.prepare('SELECT permissions FROM roles WHERE name = ?').get(name).permissions);
  expect(perms('Admin')).toEqual(['kick', 'ban_members', 'timeout_members']);
  expect(perms('Helpers')).toEqual(['pin_messages']);
  const cols = raw.prepare('PRAGMA table_info(space_members)').all().map((c) => c.name);
  expect(cols).toEqual(expect.arrayContaining(['timeout_until', 'timeout_reason']));
});

test('P9-06a (v30): each DM pair becomes one conversation with its two people, read positions and messages; unread is unchanged', () => {
  const raw = new Database(path.join(tmp, 'dms.db'));
  runMigrations(raw, MIGRATIONS.filter((m) => m.version <= 29));
  const user = raw.prepare('INSERT INTO users(username, email, password_hash, salt) VALUES (?, ?, ?, ?)');
  const [a, b, c] = ['ann', 'ben', 'cy'].map((n) => Number(user.run(n, `${n}@x.test`, 'h', 's').lastInsertRowid));
  const dm = raw.prepare('INSERT INTO dm_messages(user_a, user_b, author_id, content, created_at) VALUES (?, ?, ?, ?, ?)');
  const ids = [
    dm.run(a, b, a, 'ann to ben', 100), dm.run(a, b, b, 'ben to ann', 200), dm.run(a, b, b, 'ben again', 300),
    dm.run(a, c, c, 'cy to ann', 150), dm.run(b, c, b, 'ben to cy', 400),
  ].map((r) => Number(r.lastInsertRowid));
  raw.prepare('INSERT INTO dm_read_state(user_id, other_id, last_read_id) VALUES (?, ?, ?)').run(a, b, ids[1]); // ann read up to "ben to ann"
  raw.prepare('INSERT INTO dm_message_versions(message_id, content, written_at) VALUES (?, ?, ?)').run(ids[0], 'old text', 90);
  // Unread the old way, per person and partner.
  const oldUnread = (u) => raw.prepare(`
    SELECT CASE WHEN m.user_a = ? THEN m.user_b ELSE m.user_a END AS other, COUNT(*) AS n FROM dm_messages m
    LEFT JOIN dm_read_state rs ON rs.user_id = ? AND rs.other_id = (CASE WHEN m.user_a = ? THEN m.user_b ELSE m.user_a END)
    WHERE (m.user_a = ? OR m.user_b = ?) AND m.author_id != ? AND m.id > COALESCE(rs.last_read_id, 0) GROUP BY other ORDER BY other
  `).all(u, u, u, u, u, u);
  const before = [a, b, c].map(oldUnread);

  runMigrations(raw, MIGRATIONS.filter((m) => m.version <= 30));
  expect(raw.pragma('user_version', { simple: true })).toBe(30);
  const convs = raw.prepare('SELECT id, kind, pair_key AS pairKey, created_at AS createdAt FROM dm_conversations ORDER BY id').all();
  expect(convs.map((x) => [x.kind, x.pairKey, x.createdAt])).toEqual([['pair', `${a}:${b}`, 100], ['pair', `${a}:${c}`, 150], ['pair', `${b}:${c}`, 400]]);
  expect(raw.prepare('SELECT COUNT(*) AS n FROM dm_messages WHERE conversation_id IS NULL').get().n).toBe(0);
  expect(raw.prepare('SELECT conversation_id AS c, COUNT(*) AS n FROM dm_messages GROUP BY conversation_id ORDER BY c').all().map((r) => r.n)).toEqual([3, 1, 1]);
  const parts = raw.prepare('SELECT conversation_id AS c, user_id AS u, last_read_id AS r FROM dm_participants ORDER BY c, u').all();
  expect(parts).toEqual([
    { c: convs[0].id, u: a, r: ids[1] }, { c: convs[0].id, u: b, r: 0 },
    { c: convs[1].id, u: a, r: 0 }, { c: convs[1].id, u: c, r: 0 },
    { c: convs[2].id, u: b, r: 0 }, { c: convs[2].id, u: c, r: 0 },
  ]);
  // Unread the new way matches, person by person.
  const newUnread = (u) => raw.prepare(`
    SELECT o.user_id AS other, COUNT(*) AS n FROM dm_participants me
    JOIN dm_participants o ON o.conversation_id = me.conversation_id AND o.user_id != me.user_id
    JOIN dm_messages m ON m.conversation_id = me.conversation_id AND m.author_id != me.user_id AND m.id > me.last_read_id
    WHERE me.user_id = ? GROUP BY other ORDER BY other
  `).all(u);
  expect([a, b, c].map(newUnread)).toEqual(before);
  expect(before[0]).toEqual([{ other: b, n: 1 }, { other: c, n: 1 }]); // sanity: the seed has some unread
  // Edit history and the new columns.
  expect(raw.prepare('SELECT content FROM dm_message_versions WHERE message_id = ?').get(ids[0]).content).toBe('old text');
  expect(raw.prepare('SELECT kind FROM dm_messages WHERE id = ?').get(ids[0]).kind).toBe(null);
  raw.close();
});

test('P11-12 (v34): usernames and emails become unique whatever the case', () => {
  const raw = new Database(path.join(tmp, 'nocase.db'));
  runMigrations(raw);
  const user = raw.prepare('INSERT INTO users(username, email, password_hash, salt) VALUES (?, ?, ?, ?)');
  user.run('bob', 'bob@x.test', 'h', 's');
  expect(() => user.run('BOB', 'other@x.test', 'h', 's')).toThrow(/UNIQUE/);
  expect(() => user.run('rob', 'Bob@X.test', 'h', 's')).toThrow(/UNIQUE/);
  raw.close();
});

test('P11-12 (v34): a database with names or emails that differ only in case refuses to migrate, names them, and is left as it was', () => {
  const raw = new Database(path.join(tmp, 'clash.db'));
  runMigrations(raw, MIGRATIONS.filter((m) => m.version <= 33));
  const user = raw.prepare('INSERT INTO users(username, email, password_hash, salt) VALUES (?, ?, ?, ?)');
  user.run('bob', 'bob@x.test', 'h', 's');
  user.run('Bob', 'bob2@x.test', 'h', 's');
  user.run('amy', 'Amy@x.test', 'h', 's');
  user.run('ann', 'amy@X.test', 'h', 's');
  let error;
  try {
    runMigrations(raw);
  } catch (err) {
    error = err;
  }
  expect(error.message).toMatch(/migration 34/);
  expect(error.message).toMatch(/bob, Bob/);
  expect(error.message).toMatch(/Amy@x\.test, amy@X\.test/);
  expect(error.message).toMatch(/UPDATE users SET username/);
  expect(raw.pragma('user_version', { simple: true })).toBe(33);
  expect(raw.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'users_%_nocase'").all()).toEqual([]);
  // Renamed as the message says, it goes through.
  raw.prepare("UPDATE users SET username = 'bob2' WHERE username = 'Bob'").run();
  raw.prepare("UPDATE users SET email = 'ann@x.test' WHERE username = 'ann'").run();
  runMigrations(raw);
  expect(raw.pragma('user_version', { simple: true })).toBe(LATEST_VERSION);
  raw.close();
});
