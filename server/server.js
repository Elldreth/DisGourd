const http = require('http');
const WebSocket = require('ws');
const url = require('url');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
require('dotenv').config({ quiet: true });
const db = require('./db');

const SECRET_FILE = path.join(__dirname, '.jwt-secret');

let config = { port: 3000, jwtSecret: 'changeme' };
try {
    const configFile = require('./config.json');
    config = { ...config, ...configFile };
} catch (e) {
    console.warn('config.json not found or unreadable, using defaults.');
}

config.port = parseInt(process.env.PORT, 10) || config.port;
config.jwtSecret = process.env.JWT_SECRET || config.jwtSecret;

// Security: never run with the well-known default secret. Resolve one, in
// order of preference: an explicit JWT_SECRET / config.json value, a secret
// generated on a previous run, or a fresh one. The generated secret is written
// to a gitignored file so tokens survive restarts without ever committing a
// secret into a tracked file.
if (!config.jwtSecret || config.jwtSecret === 'changeme') {
  try {
    const saved = fs.readFileSync(SECRET_FILE, 'utf8').trim();
    if (saved) config.jwtSecret = saved;
  } catch (e) {
    /* no previously generated secret; fall through to create one */
  }
}
if (!config.jwtSecret || config.jwtSecret === 'changeme') {
  config.jwtSecret = crypto.randomBytes(48).toString('hex');
  try {
    fs.writeFileSync(SECRET_FILE, config.jwtSecret, { mode: 0o600 });
    console.warn('[security] Generated a new JWT secret and saved it to server/.jwt-secret');
  } catch (e) {
    console.warn('[security] Generated an ephemeral JWT secret (could not persist):', e.message);
  }
}

// ---- Password hashing (scrypt) ----
// scrypt ships with Node's crypto module, so there is no native dependency to
// build. Accounts created with the old HMAC scheme are transparently upgraded
// to scrypt on their next successful login.
const SCRYPT_KEYLEN = 64;
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const SCRYPT_PREFIX = 'scrypt$';

function generateSalt() {
  return crypto.randomBytes(16).toString('hex');
}

function hashPassword(password, salt) {
  const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN, SCRYPT_OPTS).toString('hex');
  return SCRYPT_PREFIX + derived;
}

function hashPasswordLegacy(password, salt) {
  return crypto.createHmac('sha256', salt).update(password).digest('hex');
}

function timingSafeEqualHex(a, b) {
  const bufA = Buffer.from(String(a), 'hex');
  const bufB = Buffer.from(String(b), 'hex');
  if (bufA.length === 0 || bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Verify a password against a stored user record.
// Returns { ok, needsUpgrade } — needsUpgrade is true for legacy HMAC accounts
// that should be re-hashed with scrypt after a successful login.
function verifyPassword(password, user) {
  if (!user || !user.password_hash) return { ok: false, needsUpgrade: false };
  if (user.password_hash.startsWith(SCRYPT_PREFIX)) {
    const stored = user.password_hash.slice(SCRYPT_PREFIX.length);
    const computed = crypto.scryptSync(password, user.salt, SCRYPT_KEYLEN, SCRYPT_OPTS).toString('hex');
    return { ok: timingSafeEqualHex(computed, stored), needsUpgrade: false };
  }
  const computed = hashPasswordLegacy(password, user.salt);
  return { ok: timingSafeEqualHex(computed, user.password_hash), needsUpgrade: true };
}

// ---- JWT (HS256, hand-rolled to avoid dependencies) ----
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

function base64urlJson(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function createToken(userId, username) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64urlJson({ alg: 'HS256', typ: 'JWT' });
  const payload = base64urlJson({ sub: userId, name: username, iat: now, exp: now + TOKEN_TTL_SECONDS });
  const data = `${header}.${payload}`;
  const signature = crypto.createHmac('sha256', config.jwtSecret).update(data).digest('base64url');
  return `${data}.${signature}`;
}

function verifyToken(token) {
  try {
    const [headerB, payloadB, signature] = token.split('.');
    if (!headerB || !payloadB || !signature) return null;
    const data = `${headerB}.${payloadB}`;
    const expected = crypto.createHmac('sha256', config.jwtSecret).update(data).digest('base64url');
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
    const payload = JSON.parse(Buffer.from(payloadB, 'base64url').toString('utf8'));
    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

// ---- Rate limiting & validation for auth endpoints ----
const rateBuckets = new Map();
function rateLimitOk(key, max, windowMs) {
  // Tests share one IP and register many users; don't throttle them.
  if (process.env.NODE_ENV === 'test') return true;
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

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

// URL path segments arrive percent-encoded; names in the database are stored
// decoded, so every segment used as a space/channel/user name must be decoded
// before comparison. Falls back to the raw value on malformed input.
function safeDecode(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function sendJson(res, code, obj) {
  res.writeHead(code);
  res.end(JSON.stringify(obj));
}

function validateSpaceName(name) {
  if (typeof name !== 'string' || !name.trim()) return 'A server name is required';
  if (name.trim().length > 60) return 'Server name must be 60 characters or fewer';
  return null;
}

function normalizeChannelName(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '');
}

function validateChannelName(name) {
  const normalized = normalizeChannelName(name);
  if (!normalized) return 'A channel name is required';
  if (normalized.length > 60) return 'Channel name must be 60 characters or fewer';
  return null;
}

// Extract @username tokens from message content (deduplicated).
function parseMentionUsernames(content) {
  const names = new Set();
  const re = /@([A-Za-z0-9_.-]{3,32})/g;
  let m;
  while ((m = re.exec(content)) !== null) names.add(m[1]);
  return [...names];
}

function validateRegistration({ username, password, email }) {
  if (typeof username !== 'string' || !/^[A-Za-z0-9_.-]{3,32}$/.test(username)) {
    return 'Username must be 3-32 characters using letters, numbers, or _ . -';
  }
  if (typeof password !== 'string' || password.length < 8 || password.length > 200) {
    return 'Password must be between 8 and 200 characters';
  }
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return 'A valid email address is required';
  }
  return null;
}

function authUserId(req, parsedUrl) {
  const auth = req.headers['authorization'];
  const token = auth && auth.startsWith('Bearer ')
    ? auth.slice(7)
    : (parsedUrl.query && parsedUrl.query.token);
  if (!token) return null;
  const payload = verifyToken(token);
  return payload ? payload.sub : null;
}

// ---- File uploads ----
const UPLOADS_DIR = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.join(__dirname, '..', 'uploads');
const MAX_UPLOAD_BYTES = parseInt(process.env.MAX_UPLOAD_BYTES, 10) || 25 * 1024 * 1024; // 25 MB default
const MAX_UPLOAD_MB = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024)) || 1;

// Executable / script types we refuse outright. Everything else is accepted;
// anything that isn't known-safe media is served as a download, never inline.
const BLOCKED_EXTENSIONS = new Set([
  '.exe', '.dll', '.msi', '.bat', '.cmd', '.com', '.scr', '.pif', '.cpl',
  '.jar', '.msc', '.vbs', '.vbe', '.ws', '.wsf', '.wsh', '.ps1', '.psm1',
  '.sh', '.bash', '.app', '.deb', '.rpm', '.dmg',
]);

const CONTENT_TYPES = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
  '.avif': 'image/avif', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
  '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/plain',
  '.log': 'text/plain', '.json': 'application/json', '.csv': 'text/csv',
  '.zip': 'application/zip', '.7z': 'application/x-7z-compressed',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

// Types safe to render inline in a browser. SVG is intentionally excluded — it
// can carry scripts — and is served as a download instead.
const INLINE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.avif',
  '.mp4', '.webm', '.mov', '.mp3', '.ogg', '.wav', '.m4a', '.pdf',
]);

function sanitizeFilename(name) {
  const base = path.basename(String(name));
  // Replace characters illegal on Windows/most filesystems and control chars,
  // and never let a name start with dots (hidden / traversal-looking).
  const cleaned = base
    .replace(/[<>:"/\\|?*]/g, '_')            // filesystem-illegal characters
    .split('').filter(ch => ch.charCodeAt(0) > 31).join('') // drop control chars
    .replace(/^\.+/, '_')                     // no leading dots (hidden/traversal)
    .trim();
  return cleaned.slice(0, 200) || 'file';
}

function uploadTooLargeError() {
  return `File exceeds the ${MAX_UPLOAD_MB} MB limit`;
}

// ---- Serving the built web client ----
// In production the Node server hosts the compiled React app so the whole thing
// runs on a single port. In development the Vite dev server handles this and
// proxies API calls back here instead.
const WEB_DIST = process.env.WEB_DIST
  ? path.resolve(process.env.WEB_DIST)
  : path.join(__dirname, '..', 'web', 'dist');

const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

function serveWebApp(pathname, res) {
  const rel = !pathname || pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const safe = path.normalize(rel).replace(/^(\.\.[\/\\])+/, '');
  let filePath = path.join(WEB_DIST, safe);
  if (filePath !== WEB_DIST && !filePath.startsWith(WEB_DIST + path.sep)) {
    filePath = path.join(WEB_DIST, 'index.html');
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      // Unknown path (or the app hasn't been built): fall back to index.html so
      // client-side routes still resolve. If there's no build at all, show a hint.
      fs.readFile(path.join(WEB_DIST, 'index.html'), (err2, html) => {
        if (err2) {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          return res.end(
            'DisGourd API is running. Build the web client with `npm run build` to serve the UI here.'
          );
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const headers = { 'Content-Type': STATIC_TYPES[ext] || 'application/octet-stream' };
    // Vite fingerprints filenames under /assets, so they're safe to cache hard.
    if (filePath.includes(`${path.sep}assets${path.sep}`)) {
      headers['Cache-Control'] = 'public, max-age=31536000, immutable';
    }
    res.writeHead(200, headers);
    res.end(content);
  });
}

// In-memory stores for tracking connected clients and presence
const clientSpaces = {}; // { spaceName: { channels: { channelName: { clients: Set<WebSocket> } } } }
const userClients = {}; // { userId: Set<WebSocket> }

function createSpace(name) {
  db.createSpace(name);
  if (!clientSpaces[name]) {
    clientSpaces[name] = { channels: {} };
    logInfo(`Space created: ${name}`);
  }
  return clientSpaces[name];
}

function createChannel(spaceName, channelName) {
  db.createChannel(spaceName, channelName);
  if (!clientSpaces[spaceName]) {
    clientSpaces[spaceName] = { channels: {} };
  }
  if (!clientSpaces[spaceName].channels[channelName]) {
    clientSpaces[spaceName].channels[channelName] = { clients: new Set() };
    logInfo(`Channel created: ${channelName} in space ${spaceName}`);
  }
  return clientSpaces[spaceName].channels[channelName];
}

// Get (or lazily create) the in-memory runtime object that tracks the live
// sockets in a channel. Unlike createChannel this does NOT touch the database —
// the channel must already exist and access must already be authorized.
function runtimeChannel(spaceName, channelName) {
  if (!clientSpaces[spaceName]) clientSpaces[spaceName] = { channels: {} };
  if (!clientSpaces[spaceName].channels[channelName]) {
    clientSpaces[spaceName].channels[channelName] = { clients: new Set() };
  }
  return clientSpaces[spaceName].channels[channelName];
}

function notifyAndDisconnectClients(clients, systemMessage, closeReasonCode = 1000, closeReasonMessage = 'Resource deleted by admin') {
  if (!clients) return;
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      if (systemMessage) {
        client.send(JSON.stringify({ type: 'system', message: systemMessage }));
      }
      client.close(closeReasonCode, closeReasonMessage);
    }
  });
}

function broadcast(channelObj, message) {
  // message is already a string or Buffer from ws library
  if (!channelObj || !channelObj.clients) return;

  channelObj.clients.forEach(client => {
    // ws clients have a readyState property
    if (client.readyState === WebSocket.OPEN) {
      client.send(message); // ws handles framing
    }
  });
}

function sendPresenceUpdate(userId, status) {
  const user = db.getUserById(userId);
  if (!user) return;
  const friends = db.getFriends(userId);
  friends.forEach(f => {
    const set = userClients[f.id];
    if (set) {
      set.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'presence', user: user.username, status }));
        }
      });
    }
  });
}

function sendFriendList(wsClient) {
  const friends = db.getFriends(wsClient.userId);
  const list = friends.map(f => ({
    username: f.username,
    online: !!(userClients[f.id] && userClients[f.id].size > 0)
  }));
  wsClient.send(JSON.stringify({ type: 'friend_list', friends: list }));
}

// Per-connection lifecycle chatter is silenced under test to keep output clean
// and to avoid "log after teardown" noise; warnings and errors still print.
const isTest = process.env.NODE_ENV === 'test';
function logInfo(...args) { if (!isTest) console.log(...args); }

// Remove a socket from its channel and from the user's presence set, emitting
// an offline presence update when the user's last connection goes away.
// Safe to call more than once for the same socket.
function detachClient(wsClient) {
  const space = clientSpaces[wsClient.spaceName];
  const channelObj = space && space.channels[wsClient.channelName];
  if (channelObj) channelObj.clients.delete(wsClient);
  const set = userClients[wsClient.userId];
  if (set) {
    set.delete(wsClient);
    if (set.size === 0) {
      delete userClients[wsClient.userId];
      sendPresenceUpdate(wsClient.userId, 'offline');
    }
  }
}

// Create HTTP server
const httpServer = http.createServer(async (req, res) => { // Made async for potential await with body parsing
  const parsedUrl = url.parse(req.url, true);
  const pathSegments = parsedUrl.pathname.split('/').filter(Boolean).map(safeDecode); // decoded, e.g. ['admin', 'spaces', 'My Space']

  // Helper to parse JSON body
  const getJsonBody = (request) => {
    return new Promise((resolve, reject) => {
      let body = '';
      request.on('data', chunk => (body += chunk));
      request.on('end', () => {
        try {
          resolve(JSON.parse(body || '{}'));
        }
        catch (e) {
          reject(new Error('Invalid JSON'));
        }
      });
      request.on('error', (err) => reject(err));
    });
  };

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  if (parsedUrl.pathname === '/register' && req.method === 'POST') {
    try {
      if (!rateLimitOk('register:' + clientIp(req), 10, 15 * 60 * 1000)) {
        res.writeHead(429);
        return res.end(JSON.stringify({ error: 'Too many attempts. Please try again later.' }));
      }
      const { username, password, email } = await getJsonBody(req);
      const invalid = validateRegistration({ username, password, email });
      if (invalid) {
        res.writeHead(400);
        return res.end(JSON.stringify({ error: invalid }));
      }
      if (db.getUserByUsername(username) || db.getUserByEmail(email)) {
        res.writeHead(409);
        return res.end(JSON.stringify({ error: 'User already exists' }));
      }
      const salt = generateSalt();
      const hash = hashPassword(password, salt);
      const userId = db.createUser(username, email, hash, salt);
      const token = createToken(userId, username);
      res.writeHead(201);
      return res.end(JSON.stringify({ token }));
    } catch (e) {
      res.writeHead(400);
      return res.end(JSON.stringify({ error: e.message }));
    }
  }
  else if (parsedUrl.pathname === '/login' && req.method === 'POST') {
    try {
      if (!rateLimitOk('login:' + clientIp(req), 15, 15 * 60 * 1000)) {
        res.writeHead(429);
        return res.end(JSON.stringify({ error: 'Too many attempts. Please try again later.' }));
      }
      const { username, password } = await getJsonBody(req);
      const user = db.getUserByUsername(username);
      const check = verifyPassword(password, user);
      if (!user || !check.ok) {
        res.writeHead(401);
        return res.end(JSON.stringify({ error: 'Invalid credentials' }));
      }
      if (check.needsUpgrade) {
        const newSalt = generateSalt();
        db.setUserPassword(user.id, hashPassword(password, newSalt), newSalt);
      }
      const token = createToken(user.id, user.username);
      res.writeHead(200);
      return res.end(JSON.stringify({ token }));
    } catch (e) {
      res.writeHead(400);
      return res.end(JSON.stringify({ error: e.message }));
    }
  }
  else if (parsedUrl.pathname === '/me' && (req.method === 'GET' || req.method === 'PATCH')) {
    const userId = authUserId(req, parsedUrl);
    if (!userId) return sendJson(res, 401, { error: 'Unauthorized' });
    if (req.method === 'PATCH') {
      const { avatar } = await getJsonBody(req);
      if (avatar != null && (typeof avatar !== 'string' || (avatar && !avatar.startsWith('/uploads/')))) {
        return sendJson(res, 400, { error: 'Avatar must be an uploaded image URL' });
      }
      db.setUserAvatar(userId, avatar || null);
    }
    const u = db.getUserById(userId);
    if (!u) return sendJson(res, 404, { error: 'User not found' });
    return sendJson(res, 200, { id: u.id, username: u.username, email: u.email, avatar: u.avatar_url || null });
  }
  // ---- Direct messages ----
  else if (pathSegments[0] === 'dms') {
    const userId = authUserId(req, parsedUrl);
    if (!userId) return sendJson(res, 401, { error: 'Unauthorized' });

    // GET /dms — conversation list with last message + unread
    if (pathSegments.length === 1 && req.method === 'GET') {
      const unread = {};
      for (const u of db.getDmUnreadCounts(userId)) unread[u.other] = u.count;
      const convos = db.getDmConversations(userId).map((c) => ({ ...c, unread: unread[c.username] || 0 }));
      return sendJson(res, 200, convos);
    }
    // GET /dms/:username/messages — history (optionally ?after=<id>)
    if (pathSegments[2] === 'messages' && req.method === 'GET') {
      const other = db.getUserByUsername(pathSegments[1]);
      if (!other) return sendJson(res, 404, { error: 'User not found' });
      const after = parseInt(parsedUrl.query.after || '0', 10);
      if (after > 0) return sendJson(res, 200, db.getDmMessagesAfter(userId, other.id, after));
      const limit = parseInt(parsedUrl.query.limit || '50', 10);
      return sendJson(res, 200, db.getDmMessages(userId, other.id, limit, 0));
    }
    return sendJson(res, 404, { error: 'Not found' });
  }
  // ---- Search ----
  else if (pathSegments[0] === 'search' && req.method === 'GET') {
    const userId = authUserId(req, parsedUrl);
    if (!userId) return sendJson(res, 401, { error: 'Unauthorized' });
    const q = String(parsedUrl.query.q || '').trim();
    if (q.length < 2) return sendJson(res, 200, { channels: [], dms: [] });
    return sendJson(res, 200, db.searchMessages(userId, q, 40));
  }
  else if (pathSegments[0] === 'friends' && pathSegments.length === 1 && req.method === 'GET') {
    const userId = authUserId(req, parsedUrl);
    if (!userId) { res.writeHead(401); return res.end(JSON.stringify({ error: 'Unauthorized' })); }
    const friends = db.getFriends(userId).map(u => ({ username: u.username }));
    res.writeHead(200);
    return res.end(JSON.stringify({ friends }));
  }
  else if (pathSegments[0] === 'friends' && pathSegments[1] === 'requests' && req.method === 'GET') {
    const userId = authUserId(req, parsedUrl);
    if (!userId) { res.writeHead(401); return res.end(JSON.stringify({ error: 'Unauthorized' })); }
    const reqs = db.getIncomingFriendRequests(userId).map(r => db.getUserById(r.from_user)?.username).filter(Boolean);
    res.writeHead(200);
    return res.end(JSON.stringify({ requests: reqs }));
  }
  else if (pathSegments[0] === 'friends' && pathSegments[1] === 'request' && req.method === 'POST') {
    const fromId = authUserId(req, parsedUrl);
    if (!fromId) { res.writeHead(401); return res.end(JSON.stringify({ error: 'Unauthorized' })); }
    const { username } = await getJsonBody(req);
    const to = db.getUserByUsername(username);
    if (!to) { res.writeHead(404); return res.end(JSON.stringify({ error: 'User not found' })); }
    db.createFriendRequest(fromId, to.id);
    res.writeHead(201);
    return res.end(JSON.stringify({ message: 'Request sent' }));
  }
  else if (pathSegments[0] === 'friends' && pathSegments[1] === 'accept' && req.method === 'POST') {
    const userId = authUserId(req, parsedUrl);
    if (!userId) { res.writeHead(401); return res.end(JSON.stringify({ error: 'Unauthorized' })); }
    const { username } = await getJsonBody(req);
    const fromUser = db.getUserByUsername(username);
    if (!fromUser) { res.writeHead(404); return res.end(JSON.stringify({ error: 'User not found' })); }
    db.removeFriendRequest(fromUser.id, userId);
    db.addFriends(userId, fromUser.id);
    res.writeHead(200);
    return res.end(JSON.stringify({ message: 'Friend added' }));
  }
  else if (pathSegments[0] === 'friends' && pathSegments[1] === 'reject' && req.method === 'POST') {
    const userId = authUserId(req, parsedUrl);
    if (!userId) { res.writeHead(401); return res.end(JSON.stringify({ error: 'Unauthorized' })); }
    const { username } = await getJsonBody(req);
    const fromUser = db.getUserByUsername(username);
    if (fromUser) { db.removeFriendRequest(fromUser.id, userId); }
    res.writeHead(200);
    return res.end(JSON.stringify({ message: 'Request removed' }));
  }
  else if (pathSegments[0] === 'friends' && pathSegments[1] && req.method === 'DELETE') {
    const userId = authUserId(req, parsedUrl);
    if (!userId) { res.writeHead(401); return res.end(JSON.stringify({ error: 'Unauthorized' })); }
    const other = db.getUserByUsername(pathSegments[1]);
    if (!other) { res.writeHead(404); return res.end(JSON.stringify({ error: 'User not found' })); }
    db.removeFriend(userId, other.id);
    res.writeHead(200);
    return res.end(JSON.stringify({ message: 'Friend removed' }));
  }
  // ---- Spaces (servers), channels, members, invites — membership-aware ----
  else if (pathSegments[0] === 'spaces') {
    const userId = authUserId(req, parsedUrl);
    if (!userId) return sendJson(res, 401, { error: 'Unauthorized' });

    // GET /spaces — servers I'm a member of
    if (pathSegments.length === 1 && req.method === 'GET') {
      return sendJson(res, 200, db.getUserSpaces(userId));
    }
    // POST /spaces — create a server (creator becomes owner), with a #general channel
    if (pathSegments.length === 1 && req.method === 'POST') {
      const { name } = await getJsonBody(req);
      const invalid = validateSpaceName(name);
      if (invalid) return sendJson(res, 400, { error: invalid });
      const spaceId = db.createSpaceOwned(name.trim(), userId);
      if (!spaceId) return sendJson(res, 409, { error: 'A server with that name already exists' });
      db.createChannel(name.trim(), 'general');
      return sendJson(res, 201, { name: name.trim(), role: 'owner', channels: ['general'] });
    }

    const spaceName = pathSegments[1];
    const space = db.getSpaceByName(spaceName);
    if (!space) return sendJson(res, 404, { error: 'Server not found' });
    const role = db.getMemberRole(space.id, userId);
    if (!role) return sendJson(res, 403, { error: 'You are not a member of this server' });
    const canManage = role === 'owner' || role === 'admin';

    // DELETE /spaces/:name — owner only
    if (pathSegments.length === 2 && req.method === 'DELETE') {
      if (role !== 'owner') return sendJson(res, 403, { error: 'Only the owner can delete this server' });
      // Notify members over the gateway before the space (and its membership) is gone.
      deliverToSpaceMembers(spaceName, JSON.stringify({ type: 'space_deleted', space: spaceName }));
      db.deleteSpace(spaceName);
      return sendJson(res, 200, { ok: true });
    }

    // GET /spaces/:name/members
    if (pathSegments[2] === 'members' && pathSegments.length === 3 && req.method === 'GET') {
      const members = db.getSpaceMembers(space.id).map((m) => ({
        username: m.username,
        avatar: m.avatar,
        role: m.role,
        online: !!(userClients[m.userId] && userClients[m.userId].size > 0),
      }));
      return sendJson(res, 200, { members });
    }

    // PATCH /spaces/:name/members/:username — change a member's role (owner only)
    if (pathSegments[2] === 'members' && pathSegments[3] && req.method === 'PATCH') {
      if (role !== 'owner') return sendJson(res, 403, { error: 'Only the owner can change roles' });
      const target = db.getUserByUsername(pathSegments[3]);
      if (!target || !db.isMember(space.id, target.id)) return sendJson(res, 404, { error: 'Member not found' });
      if (target.id === space.owner_id) return sendJson(res, 400, { error: "The owner's role can't be changed" });
      const { role: newRole } = await getJsonBody(req);
      if (newRole !== 'admin' && newRole !== 'member') return sendJson(res, 400, { error: 'Invalid role' });
      db.setMemberRole(space.id, target.id, newRole);
      deliverToSpaceMembers(spaceName, JSON.stringify({ type: 'members_changed', space: spaceName }));
      return sendJson(res, 200, { ok: true });
    }

    // DELETE /spaces/:name/members/:username — remove a member (owner: anyone but
    // the owner; admin: members only)
    if (pathSegments[2] === 'members' && pathSegments[3] && req.method === 'DELETE') {
      const target = db.getUserByUsername(pathSegments[3]);
      if (!target || !db.isMember(space.id, target.id)) return sendJson(res, 404, { error: 'Member not found' });
      if (target.id === userId) return sendJson(res, 400, { error: "You can't remove yourself" });
      const targetRole = db.getMemberRole(space.id, target.id);
      const allowed = role === 'owner' ? targetRole !== 'owner' : role === 'admin' && targetRole === 'member';
      if (!allowed) return sendJson(res, 403, { error: 'You cannot remove this member' });
      db.removeMember(space.id, target.id);
      deliverToSpaceMembers(spaceName, JSON.stringify({ type: 'members_changed', space: spaceName }));
      sendToUser(target.id, JSON.stringify({ type: 'space_left', space: spaceName }));
      return sendJson(res, 200, { ok: true });
    }

    // POST /spaces/:name/invites — any member can invite
    if (pathSegments[2] === 'invites' && pathSegments.length === 3 && req.method === 'POST') {
      const code = crypto.randomBytes(6).toString('base64url');
      db.createInvite(code, space.id, userId, null, null);
      return sendJson(res, 201, { code });
    }

    // /spaces/:name/channels ...
    if (pathSegments[2] === 'channels') {
      const channelName = pathSegments[3];
      // GET messages (members only). ?after=<id> backfills only newer messages.
      if (channelName && pathSegments[4] === 'messages' && req.method === 'GET') {
        const after = parseInt(parsedUrl.query.after || '0', 10);
        if (after > 0) return sendJson(res, 200, db.getMessagesAfter(spaceName, channelName, after));
        const limit = parseInt(parsedUrl.query.limit || '50', 10);
        const offset = parseInt(parsedUrl.query.offset || '0', 10);
        return sendJson(res, 200, db.getMessages(spaceName, channelName, limit, offset));
      }
      // POST create channel (managers only)
      if (!channelName && req.method === 'POST') {
        if (!canManage) return sendJson(res, 403, { error: 'Only the owner can create channels' });
        const { name } = await getJsonBody(req);
        const invalid = validateChannelName(name);
        if (invalid) return sendJson(res, 400, { error: invalid });
        const channel = normalizeChannelName(name);
        db.createChannel(spaceName, channel);
        deliverToSpaceMembers(spaceName, JSON.stringify({ type: 'channel_created', space: spaceName, channel }));
        return sendJson(res, 201, { name: channel });
      }
      // DELETE channel (managers only)
      if (channelName && pathSegments.length === 4 && req.method === 'DELETE') {
        if (!canManage) return sendJson(res, 403, { error: 'Only the owner can delete channels' });
        deliverToSpaceMembers(spaceName, JSON.stringify({ type: 'channel_deleted', space: spaceName, channel: channelName }));
        db.deleteChannel(spaceName, channelName);
        return sendJson(res, 200, { ok: true });
      }
    }

    return sendJson(res, 404, { error: 'Not found' });
  }
  // ---- Invites: preview and join ----
  else if (pathSegments[0] === 'invites' && pathSegments[1] && pathSegments.length === 2) {
    const userId = authUserId(req, parsedUrl);
    if (!userId) return sendJson(res, 401, { error: 'Unauthorized' });
    const invite = db.getInvite(pathSegments[1]);
    if (!invite) return sendJson(res, 404, { error: 'This invite is invalid or has expired' });
    const space = db.getSpaceById(invite.space_id);
    if (!space) return sendJson(res, 404, { error: 'That server no longer exists' });

    if (req.method === 'GET') {
      return sendJson(res, 200, {
        space: space.name,
        members: db.getSpaceMembers(space.id).length,
        alreadyMember: db.isMember(space.id, userId),
      });
    }
    if (req.method === 'POST') {
      if (invite.expires_at && Date.now() > invite.expires_at) {
        return sendJson(res, 410, { error: 'This invite has expired' });
      }
      if (invite.max_uses && invite.uses >= invite.max_uses) {
        return sendJson(res, 410, { error: 'This invite has been fully used' });
      }
      const wasMember = db.isMember(space.id, userId);
      db.addMember(space.id, userId, 'member');
      if (!wasMember) {
        db.markSpaceRead(userId, space.name); // start with a clean slate, not a wall of unread
        db.incrementInviteUses(pathSegments[1]);
        deliverToSpaceMembers(space.name, JSON.stringify({ type: 'members_changed', space: space.name }));
      }
      return sendJson(res, 200, { name: space.name });
    }
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  // Admin API Routes
  if (pathSegments[0] === 'admin') {
    // Serve admin.html for GET /admin
    if (pathSegments.length === 1 && req.method === 'GET') {
      const filePath = path.join(__dirname, '..', 'public', 'admin.html');
      fs.readFile(filePath, (err, content) => {
        if (err) {
          console.error('Error loading admin.html:', err);
          res.writeHead(500);
          return res.end('Error loading admin page. Check server logs.');
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(content);
      });
      return; // Prevent fall-through to other handlers
    }

    // Every other /admin route manages servers or channels — require a valid
    // login token. (The React client sends one; the legacy static admin page
    // does not, and would need to authenticate.)
    if (!authUserId(req, parsedUrl)) {
      res.writeHead(401);
      return res.end(JSON.stringify({ error: 'Unauthorized' }));
    }

    // API endpoint for GET /admin/state
    if (pathSegments[1] === 'state' && req.method === 'GET') {
      const state = db.getState();
      for (const spaceName in state) {
        for (const channelName in state[spaceName].channels) {
          const count =
            clientSpaces[spaceName] && clientSpaces[spaceName].channels[channelName]
              ? clientSpaces[spaceName].channels[channelName].clients.size
              : 0;
          state[spaceName].channels[channelName].clientCount = count;
        }
      }
      res.writeHead(200);
      return res.end(JSON.stringify(state));
    }
    // POST /admin/spaces
    else if (pathSegments[1] === 'spaces' && !pathSegments[2] && req.method === 'POST') {
      try {
        const { name } = await getJsonBody(req);
        if (!name) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'Space name required' }));
        }
        createSpace(name);
        res.writeHead(201);
        return res.end(JSON.stringify({ message: 'Space created', name }));
      } catch (e) {
        res.writeHead(400);
        return res.end(JSON.stringify({ error: e.message }));
      }
    }
    // PUT /admin/spaces/:spaceName
    else if (pathSegments[1] === 'spaces' && pathSegments[2] && !pathSegments[3] && req.method === 'PUT') {
      const oldName = pathSegments[2];
      const state = db.getState();
      if (!state[oldName]) {
        res.writeHead(404);
        return res.end(JSON.stringify({ error: 'Space not found' }));
      }
      try {
        const { name: newName } = await getJsonBody(req);
        if (!newName) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'New name required' }));
        }
        const success = db.renameSpace(oldName, newName);
        if (!success) {
          res.writeHead(409);
          return res.end(JSON.stringify({ error: 'Space name already exists' }));
        }
        if (clientSpaces[oldName]) {
          for (const channelName in clientSpaces[oldName].channels) {
            notifyAndDisconnectClients(
              clientSpaces[oldName].channels[channelName].clients,
              `Space '${oldName}' renamed to '${newName}' by an administrator.`,
              1000,
              'Space renamed by admin'
            );
          }
          clientSpaces[newName] = clientSpaces[oldName];
          delete clientSpaces[oldName];
        }
        console.log(`Admin renamed space '${oldName}' to '${newName}'`);
        res.writeHead(200);
        return res.end(JSON.stringify({ message: `Space renamed`, name: newName }));
      } catch (e) {
        res.writeHead(400);
        return res.end(JSON.stringify({ error: e.message }));
      }
    }
    // DELETE /admin/spaces/:spaceName
    else if (pathSegments[1] === 'spaces' && pathSegments[2] && !pathSegments[3] && req.method === 'DELETE') {
      const spaceName = pathSegments[2];
      const state = db.getState();
      if (!state[spaceName]) {
        res.writeHead(404);
        return res.end(JSON.stringify({ error: 'Space not found' }));
      }
      if (clientSpaces[spaceName]) {
        for (const channelName in clientSpaces[spaceName].channels) {
          const channelObj = clientSpaces[spaceName].channels[channelName];
          notifyAndDisconnectClients(
            channelObj.clients,
            `Space '${spaceName}' (channel '${channelName}') is being deleted by an administrator.`,
            1000,
            'Space deleted by admin'
          );
        }
      }
      db.deleteSpace(spaceName);
      delete clientSpaces[spaceName];
      console.log(`Admin deleted space: ${spaceName}`);
      res.writeHead(200);
      return res.end(JSON.stringify({ message: `Space '${spaceName}' deleted` }));
    }
    // POST /admin/spaces/:spaceName/channels
    else if (pathSegments[1] === 'spaces' && pathSegments[2] && pathSegments[3] === 'channels' && !pathSegments[4] && req.method === 'POST') {
      const spaceName = pathSegments[2];
      const state = db.getState();
      if (!state[spaceName]) {
        res.writeHead(404);
        return res.end(JSON.stringify({ error: 'Space not found' }));
      }
      try {
        const { name: channelName } = await getJsonBody(req);
        if (!channelName) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'Channel name required' }));
        }
        createChannel(spaceName, channelName);
        res.writeHead(201);
        return res.end(JSON.stringify({ message: 'Channel created', space: spaceName, channel: channelName }));
      } catch (e) {
        res.writeHead(400);
        return res.end(JSON.stringify({ error: e.message }));
      }
    }
    // PUT /admin/spaces/:spaceName/channels/:channelName
    else if (pathSegments[1] === 'spaces' && pathSegments[2] && pathSegments[3] === 'channels' && pathSegments[4] && req.method === 'PUT') {
      const spaceName = pathSegments[2];
      const oldChan = pathSegments[4];
      const state = db.getState();
      if (!state[spaceName] || !state[spaceName].channels[oldChan]) {
        res.writeHead(404);
        return res.end(JSON.stringify({ error: 'Space or Channel not found' }));
      }
      try {
        const { name: newName } = await getJsonBody(req);
        if (!newName) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'New name required' }));
        }
        const success = db.renameChannel(spaceName, oldChan, newName);
        if (!success) {
          res.writeHead(409);
          return res.end(JSON.stringify({ error: 'Channel name already exists' }));
        }
        const spaceObj = clientSpaces[spaceName];
        if (spaceObj && spaceObj.channels[oldChan]) {
          notifyAndDisconnectClients(
            spaceObj.channels[oldChan].clients,
            `Channel '${oldChan}' renamed to '${newName}' by an administrator.`,
            1000,
            'Channel renamed by admin'
          );
          spaceObj.channels[newName] = spaceObj.channels[oldChan];
          delete spaceObj.channels[oldChan];
        }
        console.log(`Admin renamed channel '${oldChan}' to '${newName}' in space '${spaceName}'`);
        res.writeHead(200);
        return res.end(JSON.stringify({ message: 'Channel renamed', name: newName }));
      } catch (e) {
        res.writeHead(400);
        return res.end(JSON.stringify({ error: e.message }));
      }
    }
    // DELETE /admin/spaces/:spaceName/channels/:channelName
    else if (pathSegments[1] === 'spaces' && pathSegments[2] && pathSegments[3] === 'channels' && pathSegments[4] && req.method === 'DELETE') {
      const spaceName = pathSegments[2];
      const channelName = pathSegments[4];
      const state = db.getState();
      if (!state[spaceName] || !state[spaceName].channels[channelName]) {
        res.writeHead(404);
        return res.end(JSON.stringify({ error: 'Space or Channel not found' }));
      }
      const channelObj = clientSpaces[spaceName] && clientSpaces[spaceName].channels[channelName];
      notifyAndDisconnectClients(
        channelObj ? channelObj.clients : null,
        `Channel '${channelName}' in space '${spaceName}' is being deleted by an administrator.`,
        1000,
        'Channel deleted by admin'
      );
      db.deleteChannel(spaceName, channelName);
      if (clientSpaces[spaceName]) {
        delete clientSpaces[spaceName].channels[channelName];
      }
      console.log(`Admin deleted channel: ${channelName} from space: ${spaceName}`);
      res.writeHead(200);
      return res.end(JSON.stringify({ message: `Channel '${channelName}' in space '${spaceName}' deleted` }));
    }
    else {
      res.writeHead(404);
      return res.end(JSON.stringify({ error: 'Admin endpoint not found' }));
    }
  }
  // Endpoint to handle file uploads
  else if (req.method === 'POST' && parsedUrl.pathname === '/uploads') {
    const userId = authUserId(req, parsedUrl);
    if (!userId) {
      res.writeHead(401);
      return res.end(JSON.stringify({ error: 'Unauthorized' }));
    }
    if (!parsedUrl.query.name) {
      res.writeHead(400);
      return res.end(JSON.stringify({ error: 'Missing filename' }));
    }
    const safeName = sanitizeFilename(parsedUrl.query.name);
    const ext = path.extname(safeName).toLowerCase();
    if (BLOCKED_EXTENSIONS.has(ext)) {
      res.writeHead(415);
      return res.end(JSON.stringify({ error: 'That file type is not allowed' }));
    }
    // Reject early if the client already tells us it is too big.
    const declared = parseInt(req.headers['content-length'] || '0', 10);
    if (declared && declared > MAX_UPLOAD_BYTES) {
      res.writeHead(413);
      return res.end(JSON.stringify({ error: uploadTooLargeError() }));
    }

    // Each upload lands in its own random subdirectory so identical filenames
    // never overwrite one another, while the original name is preserved for a
    // clean download experience.
    const token = crypto.randomBytes(9).toString('hex');
    const destDir = path.join(UPLOADS_DIR, token);
    fs.mkdirSync(destDir, { recursive: true });
    const filePath = path.join(destDir, safeName);
    const writeStream = fs.createWriteStream(filePath);

    let received = 0;
    let aborted = false;
    const failWith = (code, message) => {
      if (aborted) return;
      aborted = true;
      writeStream.destroy();
      fs.rm(destDir, { recursive: true, force: true }, () => {});
      if (!res.headersSent) {
        res.writeHead(code);
        res.end(JSON.stringify({ error: message }));
      }
    };

    req.on('data', (chunk) => {
      received += chunk.length;
      if (received > MAX_UPLOAD_BYTES) {
        failWith(413, uploadTooLargeError());
        req.destroy();
      }
    });
    req.on('error', () => failWith(400, 'Upload failed'));
    writeStream.on('error', () => failWith(500, 'Could not save file'));
    writeStream.on('finish', () => {
      if (aborted) return;
      const url = `/uploads/${token}/${encodeURIComponent(safeName)}`;
      res.writeHead(201);
      res.end(JSON.stringify({
        url,
        name: safeName,
        size: received,
        type: CONTENT_TYPES[ext] || 'application/octet-stream',
        inline: INLINE_EXTENSIONS.has(ext),
      }));
    });
    req.pipe(writeStream);
    return;
  }
  // Serve uploaded files
  else if (req.method === 'GET' && parsedUrl.pathname.startsWith('/uploads/')) {
    let requestedPath;
    try {
      requestedPath = decodeURIComponent(parsedUrl.pathname.substring('/uploads/'.length));
    } catch {
      res.writeHead(400);
      return res.end('Bad request');
    }
    const safeSuffix = path.normalize(requestedPath).replace(/^(\.\.[\/\\])+/, '');
    const filePath = path.join(UPLOADS_DIR, safeSuffix);
    // Ensure the resolved path stays inside the uploads directory.
    if (filePath !== UPLOADS_DIR && !filePath.startsWith(UPLOADS_DIR + path.sep)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }
    fs.readFile(filePath, (err, content) => {
      if (err) {
        if (err.code === 'ENOENT' || err.code === 'EISDIR') {
          res.writeHead(404);
          res.end('File not found');
        } else {
          res.writeHead(500);
          res.end('Error loading file');
        }
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      const contentType = CONTENT_TYPES[ext] || 'application/octet-stream';
      const inline = INLINE_EXTENSIONS.has(ext);
      const downloadName = path.basename(filePath);
      const asciiName = downloadName.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');
      res.writeHead(200, {
        'Content-Type': contentType,
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition':
          `${inline ? 'inline' : 'attachment'}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
        'Cache-Control': 'public, max-age=31536000, immutable',
      });
      res.end(content);
    });
    return;
  }
  // Serve static files from 'public' directory
  else if (req.method === 'GET' && parsedUrl.pathname.startsWith('/public/')) {
    const requestedPath = parsedUrl.pathname.substring('/public/'.length);
    const safeSuffix = path.normalize(requestedPath).replace(/^(\.\.[\/\\])+/, ''); // Prevent directory traversal
    const filePath = path.join(__dirname, '..', 'public', safeSuffix);

    // Ensure the resolved path is still within the public directory
    const publicDir = path.join(__dirname, '..', 'public');
    if (!filePath.startsWith(publicDir)) {
        res.writeHead(403);
        return res.end('Forbidden');
    }

    fs.readFile(filePath, (err, content) => {
      if (err) {
        if (err.code === 'ENOENT') {
          console.warn(`Static file not found: ${filePath}`);
          res.writeHead(404);
          res.end('Static file not found.');
        } else {
          console.error(`Error loading static file ${filePath}:`, err);
          res.writeHead(500);
          res.end('Error loading static file.');
        }
        return;
      }

      let contentType = 'text/plain';
      if (filePath.endsWith('.css')) {
        contentType = 'text/css';
      } else if (filePath.endsWith('.js')) {
        contentType = 'application/javascript';
      } else if (filePath.endsWith('.html')) {
        contentType = 'text/html';
      } else if (filePath.endsWith('.png')) {
        contentType = 'image/png';
      } else if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) {
        contentType = 'image/jpeg';
      } else if (filePath.endsWith('.gif')) {
        contentType = 'image/gif';
      }

      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    });
    return; // Prevent fall-through to other handlers
  }
  // Legacy API endpoints (optional, could be removed or aliased)
  else if (req.method === 'POST') {
    if (parsedUrl.pathname === '/space') {
      // This is now handled by POST /admin/spaces
      res.writeHead(405); // Method Not Allowed or redirect
      return res.end(JSON.stringify({ error: 'Deprecated. Use POST /admin/spaces' }));
    } else if (parsedUrl.pathname.startsWith('/space/') && parsedUrl.pathname.endsWith('/channel')) {
      // This is now handled by POST /admin/spaces/:spaceName/channels
      res.writeHead(405);
      return res.end(JSON.stringify({ error: 'Deprecated. Use POST /admin/spaces/:spaceName/channels' }));
    }
  }

  // Anything else: unmatched GETs serve the web client (with SPA fallback);
  // other methods get a JSON 404.
  if (req.method === 'GET') {
    return serveWebApp(parsedUrl.pathname, res);
  }
  if (!res.writableEnded) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  }
});

// Create WebSocket server and attach it to the HTTP server
const wss = new WebSocket.Server({ noServer: true }); // noServer: true allows us to use existing HTTP server for handshake

// ---- Heartbeat ----
// Ping every client periodically; any socket that fails to answer with a pong
// before the next tick is considered dead and torn down. This is what keeps
// presence accurate when a client vanishes without a clean close (crash, lost
// wifi, laptop sleep) rather than leaving a "ghost" online forever.
const HEARTBEAT_INTERVAL_MS = 30000;
const heartbeatTimer = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      detachGateway(ws);
      return ws.terminate();
    }
    ws.isAlive = false;
    try { ws.ping(); } catch { /* socket already closing */ }
  });
}, HEARTBEAT_INTERVAL_MS);
heartbeatTimer.unref(); // don't keep the process (or tests) alive just for this
wss.on('close', () => clearInterval(heartbeatTimer));

// ---- Gateway routing ----
// The client holds a single "gateway" socket. Events are routed by membership:
// a message in a server is delivered to every online member's gateway, tagged
// with its space + channel so the client can place it (and, later, drive unread).

function sendToUser(userId, frameStr) {
  const set = userClients[userId];
  if (!set) return;
  set.forEach((ws) => { if (ws.readyState === WebSocket.OPEN) ws.send(frameStr); });
}

function deliverToSpaceMembers(spaceName, frameStr) {
  const space = db.getSpaceByName(spaceName);
  if (!space) return;
  for (const m of db.getSpaceMembers(space.id)) sendToUser(m.userId, frameStr);
}

// Announce a user's online/offline transition to everyone who shares a server
// (or friendship) with them, so member lists update live.
function broadcastPresence(userId, status) {
  const user = db.getUserById(userId);
  if (!user) return;
  const frame = JSON.stringify({ type: 'presence', user: user.username, userId, status });
  const targets = new Set(db.getCoMemberIds(userId));
  for (const f of db.getFriends(userId)) targets.add(f.id);
  targets.forEach((id) => sendToUser(id, frame));
}

function detachGateway(ws) {
  const set = userClients[ws.userId];
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) {
    delete userClients[ws.userId];
    broadcastPresence(ws.userId, 'offline');
  }
}

function handleGatewayMessage(ws, raw) {
  let msg;
  try { msg = JSON.parse(raw.toString()); } catch { return; }
  const userId = ws.userId;

  switch (msg.op) {
    case 'focus': {
      if (typeof msg.space === 'string' && typeof msg.channel === 'string') {
        ws.focus = { space: msg.space, channel: msg.channel };
      } else {
        ws.focus = null;
      }
      return;
    }
    case 'read': {
      if (typeof msg.space === 'string' && typeof msg.channel === 'string') {
        db.markRead(userId, msg.space, msg.channel, parseInt(msg.lastId, 10) || 0);
      }
      return;
    }
    case 'message': {
      const space = db.getSpaceByName(msg.space);
      if (!space || !db.isMember(space.id, userId) || !db.channelExists(msg.space, msg.channel)) return;
      const content = typeof msg.content === 'string' ? msg.content : '';
      const attachment = typeof msg.attachment === 'string' ? msg.attachment : undefined;
      if (!content && !attachment) return;
      const user = db.getUserById(userId);
      const stored = db.storeMessage(msg.space, msg.channel, content, userId, attachment);
      if (stored) db.markRead(userId, msg.space, msg.channel, stored.id); // author has read their own message
      let mentions = [];
      if (stored && content) {
        const names = parseMentionUsernames(content);
        if (names.length) mentions = db.addMentions(stored.id, space.id, names);
      }
      deliverToSpaceMembers(msg.space, JSON.stringify({
        type: 'message',
        id: stored ? stored.id : undefined,
        space: msg.space,
        channel: msg.channel,
        author: user ? user.username : userId,
        authorId: userId,
        authorAvatar: user ? user.avatar_url || null : null,
        content,
        attachment,
        mentions,
        timestamp: stored ? stored.timestamp : Date.now(),
      }));
      return;
    }
    case 'edit': {
      const id = parseInt(msg.id, 10);
      const newContent = typeof msg.content === 'string' ? msg.content.trim() : '';
      if (!id || !newContent) return;
      const loc = db.getMessageLocation(id);
      if (!loc) return;
      const editedAt = db.editMessage(id, userId, newContent); // author-only in DB
      if (editedAt) {
        deliverToSpaceMembers(loc.space, JSON.stringify({
          type: 'message_update', id, space: loc.space, channel: loc.channel, content: newContent, editedAt,
        }));
      }
      return;
    }
    case 'delete': {
      const id = parseInt(msg.id, 10);
      if (!id) return;
      const loc = db.getMessageLocation(id);
      if (!loc) return;
      if (db.deleteMessage(id, userId)) {
        deliverToSpaceMembers(loc.space, JSON.stringify({
          type: 'message_delete', id, space: loc.space, channel: loc.channel,
        }));
      }
      return;
    }
    case 'react': {
      const id = parseInt(msg.id, 10);
      const emoji = typeof msg.emoji === 'string' ? msg.emoji.trim().slice(0, 16) : '';
      if (!id || !emoji) return;
      const loc = db.getMessageLocation(id);
      if (!loc) return;
      const space = db.getSpaceByName(loc.space);
      if (!space || !db.isMember(space.id, userId)) return;
      db.toggleReaction(id, userId, emoji);
      const agg = db.getReaction(id, emoji);
      deliverToSpaceMembers(loc.space, JSON.stringify({
        type: 'reaction', id, emoji, count: agg.count, users: agg.users, space: loc.space, channel: loc.channel,
      }));
      return;
    }
    case 'typing': {
      const space = db.getSpaceByName(msg.space);
      if (!space || !db.isMember(space.id, userId)) return;
      const user = db.getUserById(userId);
      const frame = JSON.stringify({
        type: 'typing', user: user ? user.username : String(userId), space: msg.space, channel: msg.channel,
      });
      // Relay only to members currently viewing this channel (excluding sender).
      for (const m of db.getSpaceMembers(space.id)) {
        const socks = userClients[m.userId];
        if (!socks) continue;
        socks.forEach((s) => {
          if (s !== ws && s.readyState === WebSocket.OPEN && s.focus &&
              s.focus.space === msg.space && s.focus.channel === msg.channel) {
            s.send(frame);
          }
        });
      }
      return;
    }

    // ---- Direct messages ----
    case 'dm': {
      const to = db.getUserByUsername(msg.to);
      if (!to || to.id === userId) return;
      const content = typeof msg.content === 'string' ? msg.content : '';
      const attachment = typeof msg.attachment === 'string' ? msg.attachment : undefined;
      if (!content && !attachment) return;
      const from = db.getUserById(userId);
      const stored = db.storeDm(userId, to.id, content, attachment);
      db.markDmRead(userId, to.id, stored.id); // sender has read their own message
      const frame = JSON.stringify({
        type: 'dm',
        id: stored.id,
        from: from.username,
        fromId: userId,
        fromAvatar: from.avatar_url || null,
        to: to.username,
        toId: to.id,
        content,
        attachment,
        timestamp: stored.timestamp,
      });
      sendToUser(userId, frame);
      sendToUser(to.id, frame);
      return;
    }
    case 'dm_focus': {
      ws.dmFocus = typeof msg.with === 'string' ? msg.with : null;
      return;
    }
    case 'dm_read': {
      const other = db.getUserByUsername(msg.with);
      if (other) db.markDmRead(userId, other.id, parseInt(msg.lastId, 10) || 0);
      return;
    }
    case 'dm_typing': {
      const to = db.getUserByUsername(msg.with);
      if (!to) return;
      const from = db.getUserById(userId);
      const frame = JSON.stringify({ type: 'dm_typing', from: from.username });
      const socks = userClients[to.id];
      if (socks) {
        socks.forEach((s) => {
          if (s.readyState === WebSocket.OPEN && s.dmFocus === from.username) s.send(frame);
        });
      }
      return;
    }
    default:
      return;
  }
}

httpServer.on('upgrade', (request, socket, head) => {
  const parsedUrl = url.parse(request.url, true);
  if (parsedUrl.pathname !== '/gateway') {
    socket.destroy();
    return;
  }
  const token = parsedUrl.query && parsedUrl.query.token;
  const payload = token ? verifyToken(token) : null;
  if (!payload) {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    ws.userId = payload.sub;
    ws.focus = null;
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    const set = userClients[ws.userId] || (userClients[ws.userId] = new Set());
    set.add(ws);
    if (set.size === 1) broadcastPresence(ws.userId, 'online');
    logInfo(`Gateway connected for user ${ws.userId} (${set.size} socket(s))`);

    ws.send(JSON.stringify({ type: 'ready' }));
    ws.send(JSON.stringify({ type: 'unread', counts: db.getUnreadCounts(ws.userId), mentions: db.getMentionCounts(ws.userId) }));
    ws.send(JSON.stringify({ type: 'dm_unread', counts: db.getDmUnreadCounts(ws.userId) }));

    ws.on('message', (raw) => handleGatewayMessage(ws, raw));
    ws.on('close', () => detachGateway(ws));
    ws.on('error', () => detachGateway(ws));
  });
});

if (require.main === module) {
  httpServer.listen(config.port, () => {
    const hasBuild = fs.existsSync(path.join(WEB_DIST, 'index.html'));
    console.log(`\n  DisGourd is running 🥒`);
    console.log(`  → Open http://localhost:${config.port} in your browser\n`);
    if (!hasBuild) {
      console.log('  Note: the web client is not built yet. Run `npm run build` (or `npm run dev`');
      console.log('  for the hot-reloading dev server) to see the UI.\n');
    }
  });
}

module.exports = { httpServer, wss, config };
