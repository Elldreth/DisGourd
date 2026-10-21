// Sign-up, sign-in and the current user's profile.
const db = require('../db');
const { config, registrationMode, checkSetupCode, clearSetupCode } = require('../config');
const { generateSalt, hashPassword, verifyPassword } = require('../auth/passwords');
const { createToken, authUserId, authPayload, TOKEN_TTL_SECONDS } = require('../auth/tokens');
const { deviceLabel } = require('../auth/device');
const { rateLimitOk, safeEqual, limitKey, accountLocked, accountFailed, accountSucceeded, ACCOUNT_MAX_FAILURES } = require('../auth/rateLimit');
const { passwordProblem } = require('../auth/commonPasswords');
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
const { broadcastPresence, sendToUser, endStaleSessions, endSession } = require('../gateway/delivery');
// Your devices list changed (P9-03): open windows reload it.
const sessionsChanged = (userId) => sendToUser(userId, JSON.stringify({ type: 'sessions_changed' }));
// A new signed-in device (P9-03) and its token.
const signIn = (req, userId, username) => {
  const token = createToken(userId, username, db.createSession(userId, deviceLabel(req.headers['user-agent'])));
  sessionsChanged(userId);
  return token;
};

// Password rules, as at sign-up (validateRegistration).
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 200;

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
      // P11-01: `setupCode` says the wizard must ask for the one-time setup code.
      const setup = db.countUsers() === 0;
      return res.end(JSON.stringify({ registration: registrationMode(), setup, ...(setup && config.requireSetupCode ? { setupCode: true } : {}) }));
    },
  },
  {
    match: ({ req, parsedUrl }) => parsedUrl.pathname === '/register' && req.method === 'POST',
    run: async ({ req, res }) => {
      try {
        if (!rateLimitOk('register:' + limitKey(req), 5, 15 * 60 * 1000)) {
          res.writeHead(429);
          return res.end(JSON.stringify({ error: 'Too many attempts. Please try again later.' }));
        }
        const { username, password, email, code, setupCode } = await getJsonBody(req);
        // The very first account bootstraps the instance (and becomes site admin),
        // so the registration mode doesn't apply to it, but (P11-01) it needs
        // the one-time setup code from the server's log or .setup-code file.
        // After that, honor the registration mode.
        const firstAccount = db.countUsers() === 0;
        let usedCode = null;
        if (firstAccount && config.requireSetupCode && !checkSetupCode(setupCode)) {
          return sendJson(res, 403, { error: "This server needs its setup code to create the first account. It's in the server's log, or in the .setup-code file next to the database." });
        }
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
        if (firstAccount) clearSetupCode(); // P11-01: spent
        const token = signIn(req, userId, username);
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
        const tooMany = () => sendJson(res, 429, { error: 'Too many attempts. Please try again later.' });
        const ip = limitKey(req);
        if (!rateLimitOk('login:' + ip, 15, 15 * 60 * 1000)) return tooMany();
        const { username, password } = await getJsonBody(req);
        if (typeof username !== 'string' || typeof password !== 'string' || password.length > 200) {
          return sendJson(res, 401, { error: 'Invalid credentials' });
        }
        // P11-08: per account too, from any address (same answer either way).
        if (accountLocked(username)) return tooMany();
        const user = db.getUserByUsername(username);
        const check = await verifyPassword(password, user);
        // Bot accounts (the /imagine bot) never sign in.
        if (!user || user.is_bot || !check.ok) {
          if (accountFailed(username) === ACCOUNT_MAX_FAILURES) {
            const name = username.replace(/[^\w.-]/g, '?').slice(0, 32);
            console.warn(`[auth] ${ACCOUNT_MAX_FAILURES} failed sign-ins for ${name} (latest from ${ip}); it's locked for 15 minutes`);
          }
          res.writeHead(401);
          return res.end(JSON.stringify({ error: 'Invalid credentials' }));
        }
        accountSucceeded(username);
        if (check.needsUpgrade) {
          const newSalt = generateSalt();
          db.setUserPassword(user.id, await hashPassword(password, newSalt), newSalt);
        }
        const token = signIn(req, user.id, user.username);
        res.writeHead(200);
        return res.end(JSON.stringify({ token }));
      } catch (e) {
        res.writeHead(400);
        return res.end(JSON.stringify({ error: e.message }));
      }
    },
  },
  {
    // POST /me/password { currentPassword, newPassword } — change your password
    // (P6-02). Every other device is signed out; this one gets a fresh token.
    match: ({ req, parsedUrl }) => parsedUrl.pathname === '/me/password' && req.method === 'POST',
    run: async ({ req, res, parsedUrl }) => {
      const me = authPayload(req, parsedUrl);
      const userId = me ? me.sub : null;
      if (!userId) return sendJson(res, 401, { error: 'Unauthorized' });
      // Per account, so a stolen token can't be used to guess the password.
      if (!rateLimitOk('password:' + userId, 10, 15 * 60 * 1000)) {
        return sendJson(res, 429, { error: 'Too many attempts. Please try again later.' });
      }
      const { currentPassword, newPassword } = await getJsonBody(req);
      if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD || newPassword.length > MAX_PASSWORD) {
        return sendJson(res, 400, { error: `Your new password must be ${MIN_PASSWORD}-${MAX_PASSWORD} characters` });
      }
      const user = db.getUserById(userId);
      const easy = passwordProblem(newPassword, user && user.username); // P11-08
      if (easy) return sendJson(res, 400, { error: easy });
      const check = typeof currentPassword === 'string' && currentPassword.length <= MAX_PASSWORD
        ? await verifyPassword(currentPassword, user)
        : { ok: false };
      if (!user || !check.ok) return sendJson(res, 403, { error: 'Your current password is incorrect' });
      if (newPassword === currentPassword) return sendJson(res, 400, { error: 'Your new password must be different from the current one' });
      const salt = generateSalt();
      db.changePassword(userId, await hashPassword(newPassword, salt), salt);
      // Every other device's session goes too (P9-03); this one stays.
      const sid = me.sid && db.getSession(me.sid) ? me.sid : db.createSession(userId, deviceLabel(req.headers['user-agent']));
      const version = db.endOtherSessions(userId, sid, false);
      endStaleSessions(userId, version);
      return sendJson(res, 200, { token: createToken(userId, user.username, sid) });
    },
  },
  {
    // Signed-in devices (P9-03): GET /me/sessions; DELETE /me/sessions/:id;
    // POST /me/sessions/sign-out-others (a fresh token for this device).
    match: ({ parsedUrl }) => parsedUrl.pathname === '/me/sessions' || parsedUrl.pathname.startsWith('/me/sessions/'),
    run: async ({ req, res, parsedUrl }) => {
      const me = authPayload(req, parsedUrl);
      if (!me) return sendJson(res, 401, { error: 'Unauthorized' });
      const rest = parsedUrl.pathname.slice('/me/sessions'.length).replace(/^\//, '');
      if (!rest && req.method === 'GET') {
        const list = db.listSessions(me.sub, TOKEN_TTL_SECONDS * 1000).map((s) => ({ ...s, current: s.id === me.sid }));
        return sendJson(res, 200, { sessions: list, olderSignIns: !me.sid });
      }
      if (rest === 'sign-out-others' && req.method === 'POST') {
        const user = db.getUserById(me.sub);
        const sid = me.sid && db.getSession(me.sid) ? me.sid : db.createSession(me.sub, deviceLabel(req.headers['user-agent']));
        const version = db.endOtherSessions(me.sub, sid);
        endStaleSessions(me.sub, version, 'signed_out_elsewhere');
        sessionsChanged(me.sub);
        return sendJson(res, 200, { token: createToken(me.sub, user.username, sid) });
      }
      if (rest && req.method === 'DELETE') {
        if (rest === me.sid) return sendJson(res, 400, { error: 'Use Log out to sign out of this device' });
        if (!db.deleteSession(me.sub, rest)) return sendJson(res, 404, { error: 'No such device' });
        endSession(me.sub, rest);
        sessionsChanged(me.sub);
        return sendJson(res, 200, { ok: true });
      }
      return sendJson(res, 405, { error: 'Method not allowed' });
    },
  },
  {
    // POST /logout — end this device's session (P9-03); the app also forgets
    // the token. Without a session (an older token) it's a no-op.
    match: ({ req, parsedUrl }) => parsedUrl.pathname === '/logout' && req.method === 'POST',
    run: async ({ req, res, parsedUrl }) => {
      const me = authPayload(req, parsedUrl);
      if (me && me.sid && db.deleteSession(me.sub, me.sid)) sessionsChanged(me.sub);
      return sendJson(res, 200, { ok: true });
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
