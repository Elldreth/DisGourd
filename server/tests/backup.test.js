// P1-16: scheduled SQLite backups with VACUUM INTO.
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { runBackup, backupSettings, startBackupSchedule } = require('../backup');

let tmp;
let db;
const quiet = { log: () => {}, error: () => {} };

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'disgourd-backup-test-'));
  db = new Database(path.join(tmp, 'live.db'));
  db.pragma('journal_mode = WAL');
  db.exec('CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)');
  const insert = db.prepare('INSERT INTO notes(body) VALUES (?)');
  for (let i = 0; i < 25; i++) insert.run(`note ${i}`);
});

afterEach(() => {
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const backupsIn = (dir) => fs.readdirSync(dir).filter((f) => /^disgourd-\d{8}-\d{6}\.db$/.test(f)).sort();

test('a backup is a complete, consistent copy', async () => {
  const dir = path.join(tmp, 'backups');
  const result = await runBackup({ db, dir, keep: 7, logger: quiet });
  expect(result.file).toBeTruthy();
  const copy = new Database(result.file, { readonly: true });
  expect(copy.pragma('integrity_check', { simple: true })).toBe('ok');
  expect(copy.prepare('SELECT COUNT(*) AS n FROM notes').get().n).toBe(25);
  copy.close();
});

test('only the newest `keep` backups are kept', async () => {
  const dir = path.join(tmp, 'backups');
  const start = Date.UTC(2026, 9, 15, 3, 0, 0);
  for (let i = 0; i < 4; i++) {
    await runBackup({ db, dir, keep: 2, logger: quiet, now: new Date(start + i * 1000) });
  }
  expect(backupsIn(dir)).toEqual(['disgourd-20261015-030002.db', 'disgourd-20261015-030003.db']);
});

test('an unwritable backup directory is logged, not thrown', async () => {
  const blocker = path.join(tmp, 'not-a-dir');
  fs.writeFileSync(blocker, 'x');
  const errors = [];
  const result = await runBackup({
    db, dir: path.join(blocker, 'backups'), keep: 7, logger: { log: () => {}, error: (...a) => errors.push(a.join(' ')) },
  });
  expect(result.error).toBeTruthy();
  expect(errors.length).toBe(1);
});

describe('backupSettings', () => {
  test('defaults next to the database', () => {
    const s = backupSettings({ DB_PATH: '/config/disgourd.db' });
    expect(s).toEqual({ dir: path.join(path.resolve('/config'), 'backups'), intervalHours: 24, keep: 7 });
  });
  test('disabled for in-memory databases or BACKUP_DIR=off', () => {
    expect(backupSettings({ DB_PATH: ':memory:' })).toBeNull();
    expect(backupSettings({ DB_PATH: '/config/disgourd.db', BACKUP_DIR: 'off' })).toBeNull();
  });
  test('reads overrides and ignores garbage', () => {
    const s = backupSettings({ DB_PATH: '/x/d.db', BACKUP_DIR: '/b', BACKUP_INTERVAL_HOURS: '6', BACKUP_KEEP: 'lots' });
    expect(s).toEqual({ dir: path.resolve('/b'), intervalHours: 6, keep: 7 });
  });
});

test('the schedule backs up on start when none is recent, and its timer does not hold the process open', async () => {
  const dir = path.join(tmp, 'backups');
  const timer = await startBackupSchedule({ db, dir, intervalHours: 24, keep: 7, logger: quiet });
  expect(backupsIn(dir)).toHaveLength(1);
  expect(timer.hasRef()).toBe(false);
  clearInterval(timer);

  // A fresh backup already exists, so a restart doesn't make another one.
  const again = await startBackupSchedule({ db, dir, intervalHours: 24, keep: 7, logger: quiet });
  expect(backupsIn(dir)).toHaveLength(1);
  clearInterval(again);
});
