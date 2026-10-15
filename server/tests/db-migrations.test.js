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
  expect(indexNames(db.raw).sort()).toEqual(['idx_dm_pair', 'idx_mentions_user', 'idx_messages_channel']);
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
