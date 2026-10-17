// Sign-up, sign-in and the current user's profile.
const db = require('../db');
const { config, registrationMode } = require('../config');
const { generateSalt, hashPassword, verifyPassword } = require('../auth/passwords');
const { createToken, authUserId } = require('../auth/tokens');
const { rateLimitOk, safeEqual, clientIp } = require('../auth/rateLimit');
const { sendJson, sanitizeCrop, readJsonBody } = require('../http/util');
const { validateRegistration, parseReactionEmoji } = require('../validate');

const MAX_STATUS_TEXT = 80;
const STATUS_DURATIONS = { '30m': 30 * 60e3, '1h': 60 * 60e3, '4h': 4 * 60 * 60e3 };

// When a status set to clear "today" should go: the next midnight where the
// user is (tzOffset is minutes, as from the browser's Date#getTimezoneOffset).
function endOfToday(now, tzOffset) {
  const offset = Number.isFinite(tzOffset) && Math.abs(tzOffset) <= 14 * 60 ? tzOffset : 0;
  const local = new Date(now - offset * 60e3); // their wall-clock, read as UTC
  const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1);
  return midnight + offset * 60e3;
}
const { broadcastPresence, sendToUser } = require('../gateway/delivery');

const getJsonBody = readJsonBody;

// Tried in order; the first match handles the request.
const routes = [
  {
    // Public: lets the login screen know whether to show a registration-code field
    // or hide sign-up entirely. Never exposes the code itself.
    match: ({ req, parsedUrl }) => parsedUrl.pathname === '/auth-info' && req.method === 'GET',
    run: async ({ res }) => {
      res.writeHead(200);
      // `setup` is true on a brand-new install (no accounts yet) — the client
      // shows a first-run wizard, and that first account becomes the site admin.
      return res.end(JSON.stringify({ registration: registrationMode(), setup: db.countUsers() === 0 }));
    },
  },
  {
    match: ({ req, parsedUrl }) => parsedUrl.pathname === '/register' && req.method === 'POST',
    run: async ({ req, res }) => {
      try {
        if (!rateLimitOk('register:' + clientIp(req), 5, 15 * 60 * 1000)) {
          res.writeHead(429);
          return res.end(JSON.stringify({ error: 'Too many attempts. Please try again later.' }));
        }
        const { username, password, email, code } = await getJsonBody(req);
        // The very first account bootstraps the instance (and becomes site admin),
        // so it's always allowed. After that, honor the registration mode.
        const firstAccount = db.countUsers() === 0;
        let usedCode = null;
        if (!firstAccount) {
          const mode = registrationMode();
          if (mode === 'closed') {
            res.writeHead(403);
            return res.end(JSON.stringify({ error: 'Registration is closed on this server.' }));
          }
          if (mode === 'code') {
            const provided = code || '';
            const envOk = config.registrationCode && safeEqual(provided, config.registrationCode);
            usedCode = envOk ? null : db.findUsableRegCode(provided);
            if (!envOk && !usedCode) {
              res.writeHead(403);
              return res.end(JSON.stringify({ error: 'A valid registration code is required to create an account.' }));
            }
          }
        }
        if (config.maxAccounts > 0 && db.countUsers() >= config.maxAccounts) {
          res.writeHead(403);
          return res.end(JSON.stringify({ error: 'This server has reached its account limit.' }));
        }
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
        const hash = await hashPassword(password, salt);
        // The checks above ran before the (slow, async) hash. Re-check the account
        // cap, claim the code and insert the user atomically so concurrent
        // sign-ups can't overrun a limit or trip the UNIQUE constraint.
        const created = db.createUserRedeemingCode({
          username, email, passwordHash: hash, salt,
          regCodeId: usedCode ? usedCode.id : null,
          maxAccounts: config.maxAccounts,
        });
        if (created.error === 'limit') return sendJson(res, 403, { error: 'This server has reached its account limit.' });
        if (created.error === 'code') return sendJson(res, 403, { error: 'A valid registration code is required to create an account.' });
        if (created.error === 'exists') return sendJson(res, 409, { error: 'User already exists' });
        const userId = created.userId;
        const token = createToken(userId, username);
        res.writeHead(201);
        return res.end(JSON.stringify({ token }));
      } catch (e) {
        res.writeHead(400);
        return res.end(JSON.stringify({ error: e.message }));
      }
    },
  },
  {
    match: ({ req, parsedUrl }) => parsedUrl.pathname === '/login' && req.method === 'POST',
    run: async ({ req, res }) => {
      try {
        if (!rateLimitOk('login:' + clientIp(req), 15, 15 * 60 * 1000)) {
          res.writeHead(429);
          return res.end(JSON.stringify({ error: 'Too many attempts. Please try again later.' }));
        }
        const { username, password } = await getJsonBody(req);
        if (typeof username !== 'string' || typeof password !== 'string' || password.length > 200) {
          return sendJson(res, 401, { error: 'Invalid credentials' });
        }
        const user = db.getUserByUsername(username);
        const check = await verifyPassword(password, user);
        if (!user || !check.ok) {
          res.writeHead(401);
          return res.end(JSON.stringify({ error: 'Invalid credentials' }));
        }
        if (check.needsUpgrade) {
          const newSalt = generateSalt();
          db.setUserPassword(user.id, await hashPassword(password, newSalt), newSalt);
        }
        const token = createToken(user.id, user.username);
        res.writeHead(200);
        return res.end(JSON.stringify({ token }));
      } catch (e) {
        res.writeHead(400);
        return res.end(JSON.stringify({ error: e.message }));
      }
    },
  },
  {
    match: ({ req, parsedUrl }) => parsedUrl.pathname === '/me' && (req.method === 'GET' || req.method === 'PATCH'),
    run: async ({ req, res, parsedUrl }) => {
      const userId = authUserId(req, parsedUrl);
      if (!userId) return sendJson(res, 401, { error: 'Unauthorized' });
      if (req.method === 'PATCH') {
        const body = await getJsonBody(req);
        // Each field is optional: only what's sent changes.
        if ('presence' in body) {
          if (!db.PRESENCE_MODES.includes(body.presence)) {
            return sendJson(res, 400, { error: 'Presence must be online, idle, dnd or invisible' });
          }
          db.setUserPresence(userId, body.presence);
          broadcastPresence(userId); // what others now see
          sendToUser(userId, JSON.stringify({ type: 'my_presence', mode: body.presence })); // your other tabs
        }
        if ('statusText' in body || 'statusEmoji' in body) {
          const { statusText = null, statusEmoji = null, statusExpiresIn = null, tzOffset } = body;
          if (statusText !== null && typeof statusText !== 'string') return sendJson(res, 400, { error: 'Status must be text' });
          const text = (statusText || '').trim();
          if (text.length > MAX_STATUS_TEXT) return sendJson(res, 400, { error: `Status can be at most ${MAX_STATUS_TEXT} characters` });
          const emoji = statusEmoji ? parseReactionEmoji(statusEmoji) : null;
          if (statusEmoji && !emoji) return sendJson(res, 400, { error: 'Status emoji must be a single emoji' });
          if (statusExpiresIn !== null && statusExpiresIn !== 'today' && !STATUS_DURATIONS[statusExpiresIn]) {
            return sendJson(res, 400, { error: 'Clear after must be 30m, 1h, 4h, today or never' });
          }
          const now = Date.now();
          const expiresAt = statusExpiresIn === 'today' ? endOfToday(now, Number(tzOffset)) : statusExpiresIn ? now + STATUS_DURATIONS[statusExpiresIn] : null;
          db.setUserStatus(userId, text, emoji, expiresAt);
          broadcastPresence(userId);
          sendToUser(userId, JSON.stringify({ type: 'my_status', ...db.getUserStatus(userId) }));
        }
        if ('avatar' in body || 'avatarOriginal' in body) {
          const { avatar, avatarOriginal, avatarCrop } = body;
          const okUrl = (v) => v == null || v === '' || (typeof v === 'string' && v.startsWith('/uploads/'));
          if (!okUrl(avatar) || !okUrl(avatarOriginal)) {
            return sendJson(res, 400, { error: 'Avatar must be an uploaded image URL' });
          }
          db.setUserAvatar(userId, avatar || null, avatarOriginal || null, sanitizeCrop(avatarCrop));
        }
      }
      const u = db.getUserById(userId);
      if (!u) return sendJson(res, 404, { error: 'User not found' });
      return sendJson(res, 200, {
        id: u.id,
        username: u.username,
        email: u.email,
        avatar: u.avatar_url || null,
        avatarOriginal: u.avatar_original || null,
        avatarCrop: u.avatar_crop ? JSON.parse(u.avatar_crop) : null,
        siteAdmin: !!u.site_admin,
        presence: db.getUserPresence(userId),
        ...db.getUserStatus(userId),
      });
    },
  },
];

// Returns true when one of these routes handled the request.
async function handle(ctx) {
  for (const route of routes) {
    if (route.match(ctx)) {
      await route.run(ctx);
      return true;
    }
  }
  return false;
}

module.exports = { handle };
