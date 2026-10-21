const crypto = require('crypto');
const net = require('net');
const { config } = require('../config');

// ---- Rate limiting & validation for auth endpoints ----
// Fixed windows per key. P11-08: the map is capped at MAX_KEYS, so a flood of
// new keys (spoofed or rotating addresses) can't grow it without bound:
// expired windows go first, then the oldest keys.
const MAX_KEYS = 50000;
const rateBuckets = new Map();
function trim(now) {
  if (rateBuckets.size <= MAX_KEYS) return;
  for (const [k, v] of rateBuckets) if (now > v.reset) rateBuckets.delete(k);
  for (const k of rateBuckets.keys()) {
    if (rateBuckets.size <= MAX_KEYS) break;
    rateBuckets.delete(k); // insertion order: the oldest first
  }
}
function rateLimitOk(key, max, windowMs) {
  if (!config.rateLimit) return true;
  const now = Date.now();
  let bucket = rateBuckets.get(key);
  if (!bucket || now > bucket.reset) {
    rateBuckets.delete(key); // re-inserted at the end, so the map stays oldest-first
    bucket = { count: 0, reset: now + windowMs };
    rateBuckets.set(key, bucket);
    trim(now);
  }
  bucket.count += 1;
  return bucket.count <= max;
}

// ---- Failed sign-ins per account (P11-08) ----
// Counted by username (lower-cased, whether or not the account exists), from
// any address: ACCOUNT_MAX_FAILURES in ACCOUNT_WINDOW_MS locks that name for
// the rest of the window. A successful sign-in clears it.
const ACCOUNT_MAX_FAILURES = 10;
const ACCOUNT_WINDOW_MS = 15 * 60 * 1000;
const accountKey = (username) => `login-account:${String(username).toLowerCase().slice(0, 64)}`;
function accountLocked(username) {
  if (!config.rateLimit) return false;
  const b = rateBuckets.get(accountKey(username));
  return !!b && Date.now() <= b.reset && b.count >= ACCOUNT_MAX_FAILURES;
}
// Count a failure; returns the count so far in this window.
function accountFailed(username) {
  if (!config.rateLimit) return 0;
  rateLimitOk(accountKey(username), ACCOUNT_MAX_FAILURES, ACCOUNT_WINDOW_MS);
  return rateBuckets.get(accountKey(username)).count;
}
function accountSucceeded(username) {
  rateBuckets.delete(accountKey(username));
}

// The key an address is limited by (P11-08): IPv4 as is (also when written
// as ::ffff:a.b.c.d); IPv6 by its /64, since one home or host gets a whole
// /64 and can rotate through it for free.
function addressKey(ip) {
  const s = String(ip || 'unknown');
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(s);
  if (mapped) return mapped[1];
  if (net.isIP(s) !== 6) return s;
  const [head, tail] = s.toLowerCase().split('%')[0].split('::');
  const a = head ? head.split(':') : [];
  const b = tail !== undefined && tail ? tail.split(':') : [];
  const words = [...a, ...Array(tail !== undefined ? 8 - a.length - b.length : 0).fill('0'), ...b];
  return `${words.slice(0, 4).map((w) => parseInt(w || '0', 16).toString(16)).join(':')}::/64`;
}

// Constant-time string comparison (avoids leaking the code via timing).
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// The address used for rate limiting. Behind a trusted proxy we take the LAST
// X-Forwarded-For hop: that's the one the proxy itself appended, while
// everything to its left is whatever the client chose to send.
function clientIp(req) {
  const direct = (req.socket && req.socket.remoteAddress) || 'unknown';
  if (!config.trustProxy) return direct;
  const hops = String(req.headers['x-forwarded-for'] || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  return hops.length ? hops[hops.length - 1] : direct;
}

// The rate-limit key for a request's address (see addressKey).
const limitKey = (req) => addressKey(clientIp(req));

module.exports = {
  rateLimitOk, safeEqual, clientIp, addressKey, limitKey, accountLocked, accountFailed, accountSucceeded,
  MAX_KEYS, ACCOUNT_MAX_FAILURES,
  // Tests only.
  _reset: () => rateBuckets.clear(),
  _size: () => rateBuckets.size,
  _expireAccountLocks: () => { for (const k of [...rateBuckets.keys()]) if (k.startsWith('login-account:')) rateBuckets.delete(k); },
};
