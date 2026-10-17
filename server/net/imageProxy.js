// Link-preview images, served through this server so the linked site never
// sees viewers' IP addresses.
//
//   proxyPath(url)  -> '/media/preview/<sig>/<b64url(url)>' (or null)
//   publicCard(card) / withPublicEmbeds(messages): rewrite card images on the
//     way out (stored cards keep the original URL)
//   serve(res, sig, enc): the GET /media/preview/... route
//
// Only URLs this server signed are fetched (an HMAC under a key derived from
// the server secret), so this is not an open proxy. Images are fetched with
// safeFetch's SSRF rules, must really be png/jpeg/gif/webp/avif (no SVG: it can
// carry script), and are cached on disk. LINK_PREVIEW_IMAGES=direct turns the
// proxy off and cards point straight at the remote image again.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { config } = require('../config');
const { safeFetch } = require('./safeFetch');

const REMOTE_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/avif'];
const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 10000;
const CONCURRENCY = 4;
const FAILED_FOR_MS = 10 * 60 * 1000;
const CACHE_MAX_BYTES = 200 * 1024 * 1024;
const CACHE_TRIM_TO = 160 * 1024 * 1024;

const isHttp = (u) => typeof u === 'string' && /^https?:\/\//i.test(u);
const enabled = () => String(process.env.LINK_PREVIEW_IMAGES || 'proxy').toLowerCase() !== 'direct';

// ---- Signing ----
let keyFor = null; // [secret, key], recomputed if the secret changes
function key() {
  if (!keyFor || keyFor[0] !== config.jwtSecret) {
    keyFor = [config.jwtSecret, crypto.createHmac('sha256', config.jwtSecret).update('disgourd:preview-image-proxy:v1').digest()];
  }
  return keyFor[1];
}
const sign = (url) => crypto.createHmac('sha256', key()).update(url).digest('base64url');

function proxyPath(url) {
  if (!isHttp(url)) return null;
  return `/media/preview/${sign(url)}/${Buffer.from(url, 'utf8').toString('base64url')}`;
}

// The URL a signed path stands for, or null if it wasn't signed by us.
function verify(sig, enc) {
  if (typeof sig !== 'string' || typeof enc !== 'string' || !/^[\w-]{43}$/.test(sig) || !/^[\w-]+$/.test(enc)) return null;
  const url = Buffer.from(enc, 'base64url').toString('utf8');
  if (!isHttp(url)) return null;
  const expected = Buffer.from(sign(url));
  const given = Buffer.from(sig);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected) ? url : null;
}

function publicCard(card) {
  if (!card) return card;
  const image = enabled() ? proxyPath(card.image) : isHttp(card.image) ? card.image : null;
  return { ...card, image };
}

function withPublicEmbeds(messages) {
  if (!Array.isArray(messages)) return messages;
  for (const m of messages) if (Array.isArray(m.embeds)) m.embeds = m.embeds.map(publicCard);
  return messages;
}

// ---- What the bytes really are ----
function sniff(buf) {
  if (buf.length < 12) return null;
  const hex = buf.subarray(0, 8).toString('hex');
  const ascii = (a, b) => buf.subarray(a, b).toString('latin1');
  if (hex === '89504e470d0a1a0a') return 'image/png';
  if (hex.startsWith('ffd8ff')) return 'image/jpeg';
  if (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a') return 'image/gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(4, 8) === 'ftyp' && ['avif', 'avis'].includes(ascii(8, 12))) return 'image/avif';
  return null;
}

// ---- Disk cache ----
function cacheDir() {
  const uploads = process.env.UPLOADS_DIR ? path.resolve(process.env.UPLOADS_DIR) : path.join(__dirname, '..', '..', 'uploads');
  return path.join(uploads, '.previews');
}

function readCached(sig) {
  try {
    const dir = cacheDir();
    const type = fs.readFileSync(path.join(dir, `${sig}.type`), 'utf8');
    return { type, body: fs.readFileSync(path.join(dir, sig)) };
  } catch {
    return null;
  }
}

let writes = 0;
function writeCached(sig, type, body) {
  const dir = cacheDir();
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `${sig}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, body);
  fs.renameSync(tmp, path.join(dir, sig));
  fs.writeFileSync(path.join(dir, `${sig}.type`), type);
  if (++writes % 25 === 0) prune(dir);
}

// Keep the cache under its cap by removing the least recently written images.
function prune(dir) {
  try {
    const files = fs
      .readdirSync(dir)
      .filter((f) => /^[\w-]{43}$/.test(f))
      .map((f) => {
        const st = fs.statSync(path.join(dir, f));
        return { f, size: st.size, at: st.mtimeMs };
      });
    let total = files.reduce((a, x) => a + x.size, 0);
    if (total <= CACHE_MAX_BYTES) return;
    for (const x of files.sort((a, b) => a.at - b.at)) {
      if (total <= CACHE_TRIM_TO) break;
      fs.rmSync(path.join(dir, x.f), { force: true });
      fs.rmSync(path.join(dir, `${x.f}.type`), { force: true });
      total -= x.size;
    }
  } catch (err) {
    console.warn('[image proxy] prune failed:', err.message);
  }
}

// ---- Fetching (shared, limited, remembered failures) ----
let active = 0;
const waiting = [];
const inflight = new Map(); // sig -> Promise<{type, body}|null>
const failedAt = new Map(); // sig -> time of the last failure

function limited(fn) {
  return new Promise((resolve, reject) => {
    const run = () => {
      active += 1;
      fn().then(resolve, reject).finally(() => {
        active -= 1;
        waiting.shift()?.();
      });
    };
    if (active < CONCURRENCY) run();
    else waiting.push(run);
  });
}

function fetchImage(sig, url) {
  if (inflight.has(sig)) return inflight.get(sig);
  const failed = failedAt.get(sig);
  if (failed && Date.now() - failed < FAILED_FOR_MS) return Promise.resolve(null);
  const p = limited(() =>
    safeFetch(url, {
      types: REMOTE_TYPES,
      as: 'buffer',
      maxBytes: MAX_BYTES,
      timeoutMs: TIMEOUT_MS,
      allowLoopback: process.env.LINK_PREVIEWS_ALLOW_LOOPBACK === '1', // tests only (safeFetch checks NODE_ENV)
    })
  )
    .catch(() => null)
    .then((res) => {
      const type = res && sniff(res.body);
      if (!type) {
        failedAt.set(sig, Date.now());
        return null;
      }
      failedAt.delete(sig);
      writeCached(sig, type, res.body);
      return { type, body: res.body };
    })
    .finally(() => inflight.delete(sig));
  inflight.set(sig, p);
  return p;
}

// ---- The route ----
function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
  res.end('Not found');
}

async function serve(res, sig, enc) {
  const url = verify(sig, enc);
  if (!url) return notFound(res);
  const image = readCached(sig) || (await fetchImage(sig, url));
  if (!image) return notFound(res);
  res.writeHead(200, {
    'Content-Type': image.type,
    'Content-Length': image.body.length,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'",
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Cache-Control': 'public, max-age=86400',
  });
  res.end(image.body);
}

module.exports = { proxyPath, verify, publicCard, withPublicEmbeds, serve, sniff, enabled };
