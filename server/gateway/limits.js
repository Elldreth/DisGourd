// Gateway rate limits (P11-03): one signed-in member can't flood everyone.
//
// Token buckets per person (shared by all their sockets): an overall bucket
// for every frame, plus tighter ones for the ops that fan out or store
// things. A refused frame is dropped; for ops where it matters the sender is
// told (`RATE_LIMITED`, at most once a second per op) so the app can say so.
// A socket that keeps sending far past the limit is closed (1008).
// Everything here follows `config.rateLimit`, which is off under test unless
// a suite turns it on.
const { config } = require('../config');

// rate: tokens per `per` ms; burst: the bucket's size. `silent`: drop without
// telling (typing indicators).
const LIMITS = {
  all: { rate: 30, per: 1000, burst: 60 },
  message: { rate: 10, per: 10000, burst: 10 },
  dm: { rate: 10, per: 10000, burst: 10 },
  react: { rate: 20, per: 10000, burst: 20 },
  typing: { rate: 1, per: 1000, burst: 1, silent: true },
  dm_typing: { rate: 1, per: 1000, burst: 1, silent: true },
  dm_group_create: { rate: 5, per: 60000, burst: 5 },
  dm_group_add: { rate: 5, per: 60000, burst: 5 },
};
// Close a socket that sends more than this many frames in FLOOD_WINDOW_MS
// (10x the overall rate, sustained for the window).
const FLOOD_WINDOW_MS = 5000;
const FLOOD_FRAMES = LIMITS.all.rate * 10 * (FLOOD_WINDOW_MS / 1000);
const MAX_SOCKETS_PER_USER = 10;

const buckets = new Map(); // `${userId}:${kind}` -> { tokens, at }

function take(key, limit, now) {
  let b = buckets.get(key);
  if (!b) {
    b = { tokens: limit.burst, at: now };
    buckets.set(key, b);
  }
  b.tokens = Math.min(limit.burst, b.tokens + ((now - b.at) * limit.rate) / limit.per);
  b.at = now;
  if (b.tokens >= 1) {
    b.tokens -= 1;
    return 0;
  }
  return Math.ceil(((1 - b.tokens) * limit.per) / limit.rate); // ms until one token
}

// Keep the map small: forget buckets that have been full for a while.
let sweptAt = 0;
function sweep(now) {
  if (now - sweptAt < 60000) return;
  sweptAt = now;
  for (const [key, b] of buckets) if (now - b.at > 120000) buckets.delete(key);
}

// May `userId` send `op` now? { ok: true } or { ok: false, retryAfterMs, silent }.
function allow(userId, op, now = Date.now()) {
  if (!config.rateLimit) return { ok: true };
  sweep(now);
  const overall = take(`${userId}:all`, LIMITS.all, now);
  if (overall) return { ok: false, retryAfterMs: overall, silent: true };
  const limit = Object.prototype.hasOwnProperty.call(LIMITS, op) && op !== 'all' ? LIMITS[op] : null;
  if (!limit) return { ok: true };
  const wait = take(`${userId}:${op}`, limit, now);
  return wait ? { ok: false, retryAfterMs: wait, silent: !!limit.silent } : { ok: true };
}

// Count a frame on this socket; true when it has flooded and should close.
function flooded(ws, now = Date.now()) {
  if (!config.rateLimit) return false;
  if (!ws.frameWindow || now - ws.frameWindow.start > FLOOD_WINDOW_MS) ws.frameWindow = { start: now, count: 0 };
  ws.frameWindow.count += 1;
  return ws.frameWindow.count > FLOOD_FRAMES;
}

// Tell the sender once a second per op (not once per dropped frame).
function shouldTell(ws, op, now = Date.now()) {
  ws.limitToldAt = ws.limitToldAt || {};
  if (now - (ws.limitToldAt[op] || 0) < 1000) return false;
  ws.limitToldAt[op] = now;
  return true;
}

const tooManySockets = (count) => config.rateLimit && count >= MAX_SOCKETS_PER_USER;

module.exports = { allow, flooded, shouldTell, tooManySockets, LIMITS, MAX_SOCKETS_PER_USER, FLOOD_FRAMES, _reset: () => buckets.clear() };
