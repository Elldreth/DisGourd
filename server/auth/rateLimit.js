const crypto = require('crypto');
const { config } = require('../config');

// ---- Rate limiting & validation for auth endpoints ----
const rateBuckets = new Map();
function rateLimitOk(key, max, windowMs) {
  if (!config.rateLimit) return true;
  const now = Date.now();
  let bucket = rateBuckets.get(key);
  if (!bucket || now > bucket.reset) {
    bucket = { count: 0, reset: now + windowMs };
    rateBuckets.set(key, bucket);
  }
  bucket.count += 1;
  if (rateBuckets.size > 5000) {
    for (const [k, v] of rateBuckets) { if (now > v.reset) rateBuckets.delete(k); }
  }
  return bucket.count <= max;
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

module.exports = { rateLimitOk, safeEqual, clientIp };
