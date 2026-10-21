// Email addresses (P12-02): add or change yours (with your password; it only
// changes once the link sent to it is used), remove it, resend the link, and
// confirm a link (no sign-in needed: it's opened from an inbox).
const db = require('../db');
const mail = require('../mail');
const templates = require('../mail/templates');
const { authUserId } = require('../auth/tokens');
const { verifyPassword } = require('../auth/passwords');
const { rateLimitOk, limitKey } = require('../auth/rateLimit');
const { emailGateActive } = require('../auth/emailGate');
const { sendJson, readJsonBody } = require('../http/util');

const CONFIRM_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_EMAIL = 254;
const looksLikeEmail = (s) => typeof s === 'string' && s.length <= MAX_EMAIL && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
// One wording for a bad address and for one that's taken, so this doesn't
// reveal which addresses have accounts (AC-5).
const CANT_USE = 'That email address can’t be used';

// Make a confirmation link for `email` and queue it. { sent } says whether it went.
function sendConfirmation(user, email) {
  const s = mail.settings();
  if (s.missing.length) return { sent: false };
  const raw = db.createEmailToken(user.id, 'confirm', email, CONFIRM_TTL_MS);
  const link = `${s.publicUrl}/#confirm-email=${raw}`;
  const r = mail.send({ to: email, ...templates.confirmEmail({ serverName: s.serverName, publicUrl: s.publicUrl, username: user.username, link }) });
  return { sent: r.queued, reason: r.queued ? undefined : r.reason };
}

// The email part of GET /me.
function emailView(user) {
  return {
    email: user.email || null,
    emailVerified: !!user.email_verified_at,
    emailPending: db.pendingEmail(user.id),
  };
}

// The same check (and limiter) as changing your password.
async function passwordOk(userId, user, password) {
  if (!rateLimitOk('password:' + userId, 10, 15 * 60 * 1000)) return 'limited';
  if (typeof password !== 'string' || password.length > 200) return 'wrong';
  const check = await verifyPassword(password, user);
  return check.ok ? 'ok' : 'wrong';
}

const routes = [
  {
    // POST /me/email { email, password } — add or change your address.
    // DELETE /me/email { password } — remove it.
    match: ({ req, parsedUrl }) => parsedUrl.pathname === '/me/email' && (req.method === 'POST' || req.method === 'DELETE'),
    run: async ({ req, res, parsedUrl }) => {
      const userId = authUserId(req, parsedUrl);
      if (!userId) return sendJson(res, 401, { error: 'Unauthorized' });
      const user = db.getUserById(userId);
      const body = await readJsonBody(req);
      const pw = await passwordOk(userId, user, body.password);
      if (pw === 'limited') return sendJson(res, 429, { error: 'Too many attempts. Please try again later.' });
      if (pw === 'wrong') return sendJson(res, 403, { error: 'Your password is incorrect' });

      if (req.method === 'DELETE') {
        if (emailGateActive() && !user.site_admin) {
          return sendJson(res, 409, { error: 'This server requires a confirmed email, so it can’t be removed. You can change it instead.' });
        }
        db.setUserEmail(userId, null);
        db.createEmailToken(userId, 'confirm', null, 0); // cancels a waiting link
        return sendJson(res, 200, emailView(db.getUserById(userId)));
      }

      const email = typeof body.email === 'string' ? body.email.trim() : '';
      if (!looksLikeEmail(email) || db.emailConfirmedElsewhere(email, userId)) return sendJson(res, 400, { error: CANT_USE });
      if (user.email && user.email.toLowerCase() === email.toLowerCase() && user.email_verified_at) {
        return sendJson(res, 200, { ...emailView(user), sent: false }); // already yours and confirmed
      }
      if (!mail.enabled()) {
        // Nothing can be confirmed while email is off: keep it, unconfirmed.
        // P13-04: someone else's unconfirmed claim on it gives way.
        db.releaseUnconfirmedEmail(email, userId);
        db.setUserEmail(userId, email);
        return sendJson(res, 200, { ...emailView(db.getUserById(userId)), sent: false });
      }
      const { sent, reason } = sendConfirmation(user, email);
      if (!sent) {
        return sendJson(res, 429, { error: reason === 'recipient' ? 'That address has had several emails this hour. Try again later.' : 'The server can’t send more email today. Try again tomorrow.' });
      }
      return sendJson(res, 202, { ...emailView(db.getUserById(userId)), sent: true });
    },
  },
  {
    // POST /me/email/resend — a fresh link to the waiting (or current, unconfirmed) address.
    match: ({ req, parsedUrl }) => parsedUrl.pathname === '/me/email/resend' && req.method === 'POST',
    run: async ({ req, res, parsedUrl }) => {
      const userId = authUserId(req, parsedUrl);
      if (!userId) return sendJson(res, 401, { error: 'Unauthorized' });
      const user = db.getUserById(userId);
      const email = db.pendingEmail(userId) || (!user.email_verified_at ? user.email : null);
      if (!email) return sendJson(res, 400, { error: 'There’s no address waiting to be confirmed' });
      if (!mail.enabled()) return sendJson(res, 409, { error: 'This server can’t send email right now' });
      if (!rateLimitOk('email-resend:' + userId, 3, 60 * 60 * 1000)) {
        return sendJson(res, 429, { error: 'That’s 3 links this hour. Check your spam folder, or try again later.' });
      }
      const { sent } = sendConfirmation(user, email);
      if (!sent) return sendJson(res, 429, { error: 'The server can’t send more email right now. Try again later.' });
      return sendJson(res, 202, { ...emailView(db.getUserById(userId)), sent: true });
    },
  },
  {
    // POST /email/confirm { token } — from the link in the email; no sign-in needed.
    match: ({ req, parsedUrl }) => parsedUrl.pathname === '/email/confirm' && req.method === 'POST',
    run: async ({ req, res }) => {
      if (!rateLimitOk('email-confirm:' + limitKey(req), 20, 15 * 60 * 1000)) {
        return sendJson(res, 429, { error: 'Too many attempts. Please try again later.' });
      }
      const { token } = await readJsonBody(req);
      const used = db.useEmailToken(token, 'confirm');
      if (!used || !used.email) {
        return sendJson(res, 400, { error: 'This link has expired or was already used', code: 'TOKEN_INVALID' });
      }
      if (db.confirmUserEmail(used.userId, used.email) === 'taken') {
        return sendJson(res, 409, { error: 'That address was confirmed by another account in the meantime', code: 'TAKEN' });
      }
      console.warn(`[email] user ${used.userId} confirmed an address at …@${used.email.split('@').pop()}`);
      return sendJson(res, 200, { ok: true, email: used.email });
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

module.exports = { handle, sendConfirmation, emailView, looksLikeEmail };
