const crypto = require('crypto');

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

// Async scrypt: the synchronous variant blocked the event loop (and with it
// every chat socket) for each login attempt.
function scryptHex(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(password), salt, SCRYPT_KEYLEN, SCRYPT_OPTS, (err, key) => {
      if (err) reject(err);
      else resolve(key.toString('hex'));
    });
  });
}

async function hashPassword(password, salt) {
  return SCRYPT_PREFIX + (await scryptHex(password, salt));
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
// Resolves { ok, needsUpgrade } — needsUpgrade is true for legacy HMAC accounts
// that should be re-hashed with scrypt after a successful login.
const DUMMY_SALT = generateSalt();
async function verifyPassword(password, user) {
  if (!user || !user.password_hash) {
    // Spend the same time as a real check so response timing doesn't reveal
    // which usernames exist.
    await scryptHex(password, DUMMY_SALT);
    return { ok: false, needsUpgrade: false };
  }
  if (user.password_hash.startsWith(SCRYPT_PREFIX)) {
    const stored = user.password_hash.slice(SCRYPT_PREFIX.length);
    const computed = await scryptHex(password, user.salt);
    return { ok: timingSafeEqualHex(computed, stored), needsUpgrade: false };
  }
  const computed = hashPasswordLegacy(password, user.salt);
  return { ok: timingSafeEqualHex(computed, user.password_hash), needsUpgrade: true };
}

module.exports = { generateSalt, hashPassword, hashPasswordLegacy, verifyPassword };
