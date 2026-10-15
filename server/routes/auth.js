// Sign-up, sign-in and the current user's profile.
const db = require('../db');
const { config, registrationMode } = require('../config');
const { generateSalt, hashPassword, verifyPassword } = require('../auth/passwords');
const { createToken, authUserId } = require('../auth/tokens');
const { rateLimitOk, safeEqual, clientIp } = require('../auth/rateLimit');
const { sendJson, sanitizeCrop, readJsonBody } = require('../http/util');
const { validateRegistration } = require('../validate');

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
        const userId = db.createUser(username, email, hash, salt);
        if (usedCode) db.incrementRegCodeUses(usedCode.id);
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
        const { avatar, avatarOriginal, avatarCrop } = await getJsonBody(req);
        const okUrl = (v) => v == null || v === '' || (typeof v === 'string' && v.startsWith('/uploads/'));
        if (!okUrl(avatar) || !okUrl(avatarOriginal)) {
          return sendJson(res, 400, { error: 'Avatar must be an uploaded image URL' });
        }
        db.setUserAvatar(userId, avatar || null, avatarOriginal || null, sanitizeCrop(avatarCrop));
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
