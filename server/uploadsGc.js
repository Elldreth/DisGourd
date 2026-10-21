// Upload quotas and clean-up (P11-04).
//
// Every upload lives in its own folder, /uploads/<token>/<name>. A folder is
// removed when nothing uses it any more:
//   - processQueue(): the attachments of deleted messages and DMs (queued by
//     triggers, so channel, server and conversation deletes count too) go,
//     unless another message, an avatar, a server icon, an emoji or an
//     /imagine job still points at them. Runs every 30 s.
//   - sweep(): once a day, any upload folder older than a day that nothing
//     uses (abandoned uploads, old avatars). `.previews` is left alone.
// The `uploads` table records who uploaded how much and when, for the daily
// quota; rows are kept for a week whether or not the file still exists, so
// deleting doesn't refill your quota.
const fs = require('fs');
const path = require('path');
const db = require('./db');

const UPLOADS_DIR = process.env.UPLOADS_DIR ? path.resolve(process.env.UPLOADS_DIR) : path.join(__dirname, '..', 'uploads');
const TOKEN_DIR = /^[a-f0-9]{18}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const SWEEP_MIN_AGE_MS = DAY_MS;

// ---- Quota ----
const quotaBytes = () => parseInt(process.env.UPLOAD_QUOTA_BYTES_PER_DAY, 10) || 500 * 1024 * 1024;
const maxTotalBytes = () => parseInt(process.env.UPLOADS_MAX_TOTAL_BYTES, 10) || 0;

function usedToday(userId, now = Date.now()) {
  return db.raw.prepare('SELECT COALESCE(SUM(bytes), 0) AS n FROM uploads WHERE user_id = ? AND created_at > ?').get(userId, now - DAY_MS).n;
}
function recordUpload(token, userId, bytes) {
  db.raw.prepare('INSERT OR REPLACE INTO uploads(token, user_id, bytes, created_at) VALUES (?, ?, ?, ?)').run(token, userId, bytes, Date.now());
  if (total !== null) total += bytes;
}

// ---- Total size (for UPLOADS_MAX_TOTAL_BYTES) ----
let total = null; // bytes in UPLOADS_DIR, worked out on first use
function folderBytes(dir) {
  let sum = 0;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sum += folderBytes(p);
    else if (e.isFile()) {
      try {
        sum += fs.statSync(p).size;
      } catch {
        /* gone meanwhile */
      }
    }
  }
  return sum;
}
function totalBytes() {
  if (total === null) total = folderBytes(UPLOADS_DIR);
  return total;
}

// ---- What's in use ----
const URL_TOKEN = /\/uploads\/([a-f0-9]{18})\//g;
function tokensIn(text) {
  const out = [];
  for (const m of String(text || '').matchAll(URL_TOKEN)) out.push(m[1]);
  return out;
}
// Every upload token something in the database points at.
const REFERENCES = [
  'SELECT attachments AS v FROM messages WHERE attachments IS NOT NULL',
  'SELECT attachment_url AS v FROM messages WHERE attachment_url IS NOT NULL',
  'SELECT attachments AS v FROM dm_messages WHERE attachments IS NOT NULL',
  'SELECT attachment_url AS v FROM dm_messages WHERE attachment_url IS NOT NULL',
  'SELECT avatar_url AS v FROM users WHERE avatar_url IS NOT NULL',
  'SELECT avatar_original AS v FROM users WHERE avatar_original IS NOT NULL',
  'SELECT icon_url AS v FROM spaces WHERE icon_url IS NOT NULL',
  'SELECT icon_original AS v FROM spaces WHERE icon_original IS NOT NULL',
  'SELECT url AS v FROM space_emoji',
  'SELECT source_url AS v FROM imagine_jobs WHERE source_url IS NOT NULL',
];
function referencedTokens() {
  const set = new Set();
  for (const sql of REFERENCES) {
    for (const { v } of db.raw.prepare(sql).all()) for (const t of tokensIn(v)) set.add(t);
  }
  return set;
}

function removeFolder(token) {
  if (!TOKEN_DIR.test(token)) return false;
  const dir = path.join(UPLOADS_DIR, token);
  if (!fs.existsSync(dir)) return false;
  const bytes = folderBytes(dir);
  fs.rmSync(dir, { recursive: true, force: true });
  if (total !== null) total = Math.max(0, total - bytes);
  return true;
}

// ---- The queue (deleted messages' attachments) ----
let running = false;
async function processQueue() {
  if (running) return { removed: 0 };
  running = true;
  let removed = 0;
  try {
    const rows = db.raw.prepare('SELECT id, urls FROM upload_gc_queue ORDER BY id LIMIT 500').all();
    if (!rows.length) return { removed };
    const candidates = new Set(rows.flatMap((r) => tokensIn(r.urls)));
    const inUse = referencedTokens();
    for (const token of candidates) if (!inUse.has(token) && removeFolder(token)) removed += 1;
    db.raw.prepare(`DELETE FROM upload_gc_queue WHERE id <= ?`).run(rows[rows.length - 1].id);
    if (removed) console.log(`[uploads] Removed ${removed} file folder(s) of deleted messages`);
  } catch (err) {
    console.warn('[uploads] Clean-up failed:', err.message);
  } finally {
    running = false;
  }
  return { removed };
}

// ---- The daily sweep ----
async function sweep(now = Date.now()) {
  let removed = 0;
  try {
    const inUse = referencedTokens();
    let names = [];
    try {
      names = fs.readdirSync(UPLOADS_DIR);
    } catch {
      return { removed };
    }
    for (const name of names) {
      if (!TOKEN_DIR.test(name) || inUse.has(name)) continue; // .previews and other names are left alone
      let st;
      try {
        st = fs.statSync(path.join(UPLOADS_DIR, name));
      } catch {
        continue;
      }
      if (!st.isDirectory() || now - st.mtimeMs < SWEEP_MIN_AGE_MS) continue;
      if (removeFolder(name)) removed += 1;
    }
    db.raw.prepare('DELETE FROM uploads WHERE created_at < ?').run(now - 7 * DAY_MS);
    total = folderBytes(UPLOADS_DIR); // re-count now and then
    if (removed) console.log(`[uploads] Swept ${removed} unused file folder(s)`);
  } catch (err) {
    console.warn('[uploads] Sweep failed:', err.message);
  }
  return { removed };
}

// Timers, for the running server only (not tests).
function start() {
  setInterval(processQueue, 30 * 1000).unref();
  setTimeout(sweep, 60 * 1000).unref();
  setInterval(sweep, DAY_MS).unref();
}

module.exports = { quotaBytes, maxTotalBytes, usedToday, recordUpload, totalBytes, processQueue, sweep, start, referencedTokens, tokensIn, UPLOADS_DIR };
