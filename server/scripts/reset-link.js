#!/usr/bin/env node
// P12-03: a one-time password reset link from the server's console, for an
// owner locked out of the only site admin account (or anyone, when email is
// off and no admin can sign in). It works once, for 24 hours, and replaces
// any earlier reset link for that account.
//
//   node server/scripts/reset-link.js <username>
//   docker exec disgourd node server/scripts/reset-link.js <username>
//
// Uses the same database as the server (DB_PATH). Prints the link with
// PUBLIC_URL when it's set, otherwise the part to add after your site's address.
const username = process.argv[2];
if (!username) {
  console.error('Usage: node server/scripts/reset-link.js <username>');
  process.exit(2);
}
const db = require('../db');

const user = db.getUserByUsername(username);
if (!user || user.is_bot) {
  console.error(`No account named "${username}".`);
  process.exit(1);
}
const raw = db.createEmailToken(user.id, 'reset', null, 24 * 60 * 60 * 1000);
const base = String(process.env.PUBLIC_URL || '').trim().replace(/\/+$/, '');
console.log(`A reset link for ${user.username} (works once, for 24 hours):`);
console.log(base ? `${base}/#reset=${raw}` : `<your site's address>/#reset=${raw}`);
