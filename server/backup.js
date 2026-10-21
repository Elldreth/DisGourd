// Scheduled database backups. `VACUUM INTO` writes a compacted, consistent copy
// of the live database (safe under WAL, no need to stop the server) to
// <dir>/disgourd-YYYYMMDD-HHMMSS.db (UTC), and the oldest copies beyond `keep`
// are deleted. Failures are logged, never thrown: a full disk must not take the
// chat server down.
const fs = require('fs');
const path = require('path');

const BACKUP_FILE = /^disgourd-\d{8}-\d{6}\.db$/;
const HOUR_MS = 60 * 60 * 1000;

const pad = (n) => String(n).padStart(2, '0');
function backupName(date) {
  return `disgourd-${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}.db`;
}

// Backup files in `dir`, oldest first (the names sort chronologically).
function listBackups(dir) {
  try {
    return fs.readdirSync(dir).filter((f) => BACKUP_FILE.test(f)).sort();
  } catch {
    return [];
  }
}

// Settings from the environment, or null when backups are off: an in-memory
// database has nothing to back up, and BACKUP_DIR=off opts out.
function backupSettings(env = process.env) {
  const dbPath = env.DB_PATH || path.join(__dirname, 'db', 'disgourd.db');
  if (dbPath === ':memory:' || String(env.BACKUP_DIR || '').toLowerCase() === 'off') return null;
  const positive = (v, def) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : def;
  };
  return {
    dir: env.BACKUP_DIR ? path.resolve(env.BACKUP_DIR) : path.join(path.dirname(path.resolve(dbPath)), 'backups'),
    intervalHours: positive(env.BACKUP_INTERVAL_HOURS, 24),
    keep: positive(env.BACKUP_KEEP, 7),
  };
}

// Write one backup, then prune. Resolves { file } or { error }.
async function runBackup({ db, dir, keep = 7, logger = console, now = new Date() }) {
  try {
    // P11-13 (L2): copies hold password hashes, DMs and any saved kie.ai key,
    // so only the server's own user can read them.
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, backupName(now));
    db.prepare('VACUUM INTO ?').run(file);
    fs.chmodSync(file, 0o600);
    // A folder and copies made before this version keep their old modes: tighten them too.
    try {
      fs.chmodSync(dir, 0o700);
      for (const old of listBackups(dir)) fs.chmodSync(path.join(dir, old), 0o600);
    } catch {
      /* not ours to change (a shared folder): the new copy is still 0600 */
    }
    const all = listBackups(dir);
    for (const old of all.slice(0, Math.max(0, all.length - keep))) {
      fs.rmSync(path.join(dir, old), { force: true });
    }
    logger.log(`[backup] Saved ${file}`);
    return { file };
  } catch (err) {
    logger.error(`[backup] Failed to write a backup to ${dir}: ${err.message}`);
    return { error: err };
  }
}

// Back up now if the newest backup is older than the interval (or there is
// none), then every interval. Resolves the timer, which is unref'd so it never
// keeps the process alive.
async function startBackupSchedule({ db, dir, intervalHours = 24, keep = 7, logger = console }) {
  const intervalMs = intervalHours * HOUR_MS;
  const newest = listBackups(dir).pop();
  let newestAge = Infinity;
  if (newest) {
    try {
      newestAge = Date.now() - fs.statSync(path.join(dir, newest)).mtimeMs;
    } catch {
      /* treat as missing */
    }
  }
  if (newestAge >= intervalMs) await runBackup({ db, dir, keep, logger });
  const timer = setInterval(() => { runBackup({ db, dir, keep, logger }); }, intervalMs);
  timer.unref();
  return timer;
}

module.exports = { runBackup, startBackupSchedule, backupSettings, listBackups };
