// P12-02: when a site admin turns on "Require a confirmed email" (and the
// server can send email), accounts without a confirmed address can only reach
// what they need to confirm one. Site admins are never held back, so the
// owner can't lock themselves out, and nothing is held back while email is
// off (nobody could confirm anything).
const db = require('../db');
const mail = require('../mail');

function emailGateActive() {
  return db.emailConfirmRequired() && mail.enabled();
}

function gated(userId) {
  if (!userId || !emailGateActive()) return false;
  const u = db.getUserById(userId);
  return !!u && !u.site_admin && !u.is_bot && !u.email_verified_at;
}

// What a held-back account may still call.
const OPEN = new Set(['/me', '/me/email', '/me/email/resend', '/logout', '/email/confirm', '/auth-info']);
const allowedWhileGated = (pathname) => OPEN.has(pathname);

module.exports = { emailGateActive, gated, allowedWhileGated };
