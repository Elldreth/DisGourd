// Password reset (P12-03): "Forgot password?" emails a one-time link (30
// minutes) to the account's *confirmed* address; the link sets a new
// password, ends every session, and signs this device in. The forgot answer
// is the same whatever the account (or whether it exists), and takes about
// the same time, so it can't be used to find accounts.
const db = require('../db');
const mail = require('../mail');
const templates = require('../mail/templates');
const { generateSalt, hashPassword } = require('../auth/passwords');
const { createToken } = require('../auth/tokens');
const { deviceLabel } = require('../auth/device');
const { rateLimitOk, limitKey } = require('../auth/rateLimit');
const { passwordProblem } = require('../auth/commonPasswords');
const { endStaleSessions, sendToUser } = require('../gateway/delivery');
const { sendJson, readJsonBody } = require('../http/util');

const RESET_TTL_MS = 30 * 60 * 1000;
const ADMIN_LINK_TTL_MS = 24 * 60 * 60 * 1000;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 200;
const FORGOT_ANSWER = { ok: true, message: 'If that account has a confirmed email, a reset link is on its way. It expires in 30 minutes.' };
// Every forgot answer takes at least this long, found or not.
const FORGOT_MIN_MS = 400;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The account a "username or email" points at, or undefined.
function findAccount(login) {
  if (typeof login !== 'string') return undefined;
  const value = login.trim();
  if (!value || value.length > 254) return undefined;
  const user = value.includes('@') ? db.getUserByEmail(value) : db.getUserByUsername(value);
  return user && !user.is_bot ? user : undefined;
}

// A reset link for this account (no email sent): for the admin's "Make a
// reset link" and the console tool. Returns the raw token.
function makeResetToken(userId, ttlMs = ADMIN_LINK_TTL_MS) {
  return db.createEmailToken(userId, 'reset', null, ttlMs);
}

const routes = [
  {
    // POST /password/forgot { login } — username or email.
    match: ({ req, parsedUrl }) => parsedUrl.pathname === '/password/forgot' && req.method === 'POST',
    run: async ({ req, res }) => {
      if (!rateLimitOk('forgot:' + limitKey(req), 5, 15 * 60 * 1000)) {
        return sendJson(res, 429, { error: 'Too many attempts. Please try again later.' });
      }
      const started = Date.now();
      const { login } = await readJsonBody(req);
      const user = findAccount(login);
      const s = mail.settings();
      if (user && user.email && user.email_verified_at && !s.missing.length && rateLimitOk('reset-mail:' + user.id, 3, 60 * 60 * 1000)) {
        const raw = db.createEmailToken(user.id, 'reset', user.email, RESET_TTL_MS);
        mail.send({
          to: user.email,
          ...templates.resetPassword({ serverName: s.serverName, publicUrl: s.publicUrl, username: user.username, link: `${s.publicUrl}/#reset=${raw}` }),
        });
        console.warn(`[password] reset link sent for user ${user.id} to …@${user.email.split('@').pop()}`);
      }
      const wait = FORGOT_MIN_MS - (Date.now() - started);
      if (wait > 0) await sleep(wait);
      return sendJson(res, 200, FORGOT_ANSWER);
    },
  },
  {
    // POST /password/reset { token, newPassword } — from the emailed (or admin-made) link.
    match: ({ req, parsedUrl }) => parsedUrl.pathname === '/password/reset' && req.method === 'POST',
    run: async ({ req, res }) => {
      if (!rateLimitOk('reset:' + limitKey(req), 20, 15 * 60 * 1000)) {
        return sendJson(res, 429, { error: 'Too many attempts. Please try again later.' });
      }
      const { token, newPassword } = await readJsonBody(req);
      if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD || newPassword.length > MAX_PASSWORD) {
        return sendJson(res, 400, { error: `Your new password must be ${MIN_PASSWORD}-${MAX_PASSWORD} characters` });
      }
      // Check the password's strength before spending the token, so a weak
      // choice doesn't waste the link. That needs the account: peek first.
      const peek = db.peekEmailToken(token, 'reset');
      if (!peek) return sendJson(res, 400, { error: 'This link has expired or was already used', code: 'TOKEN_INVALID' });
      const user = db.getUserById(peek.userId);
      if (!user) return sendJson(res, 400, { error: 'This link has expired or was already used', code: 'TOKEN_INVALID' });
      const easy = passwordProblem(newPassword, user.username); // P11-08
      if (easy) return sendJson(res, 400, { error: easy });
      const used = db.useEmailToken(token, 'reset');
      if (!used || used.userId !== user.id) return sendJson(res, 400, { error: 'This link has expired or was already used', code: 'TOKEN_INVALID' });
      const salt = generateSalt();
      db.changePassword(user.id, await hashPassword(newPassword, salt), salt);
      // Every session ends (whoever had the old password is out), then this device signs in.
      const version = db.endOtherSessions(user.id, null, false);
      endStaleSessions(user.id, version);
      console.warn(`[password] user ${user.id} reset their password`);
      if (user.suspended_at) return sendJson(res, 200, { ok: true, suspended: true }); // can't sign in
      const sid = db.createSession(user.id, deviceLabel(req.headers['user-agent']));
      sendToUser(user.id, JSON.stringify({ type: 'sessions_changed' }));
      return sendJson(res, 200, { ok: true, token: createToken(user.id, user.username, sid) });
    },
  },
];

async function handle(ctx) {
  for (const route of routes) {
    if (route.match(ctx)) {
      await route.run(ctx);
      return true;
    }
  }
  return false;
}

module.exports = { handle, makeResetToken, findAccount, RESET_TTL_MS, ADMIN_LINK_TTL_MS };
