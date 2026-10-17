const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('./db');

// Where a generated JWT secret is persisted. With an explicit DB_PATH (e.g. the
// Docker /config volume) it lives next to the database so it survives image
// rebuilds; otherwise it sits in the (gitignored) server directory.
const SECRET_FILE = process.env.JWT_SECRET_FILE
  || (process.env.DB_PATH && process.env.DB_PATH !== ':memory:'
    ? path.join(path.dirname(path.resolve(process.env.DB_PATH)), '.jwt-secret')
    : path.join(__dirname, '.jwt-secret'));

let config = { port: 3000, jwtSecret: 'changeme' };
try {
    const configFile = require('./config.json');
    config = { ...config, ...configFile };
} catch (e) {
    console.warn('config.json not found or unreadable, using defaults.');
}

config.port = parseInt(process.env.PORT, 10) || config.port;
config.jwtSecret = process.env.JWT_SECRET || config.jwtSecret;

// Registration gating. Modes: 'open' (anyone), 'code' (a shared secret is
// required), 'closed' (no new accounts). Setting a REGISTRATION_CODE implies
// 'code' unless a mode is given explicitly. MAX_ACCOUNTS caps total accounts.
config.registrationCode = process.env.REGISTRATION_CODE || config.registrationCode || '';
let regMode = (process.env.REGISTRATION_MODE || config.registrationMode || '').toLowerCase();
if (!['open', 'code', 'closed'].includes(regMode)) regMode = config.registrationCode ? 'code' : 'open';
config.registrationMode = regMode;
config.maxAccounts = parseInt(process.env.MAX_ACCOUNTS, 10) || parseInt(config.maxAccounts, 10) || 0;
// Threads with no new reply for this many days are archived (reopened by a post).
config.threadArchiveDays = parseInt(process.env.THREAD_ARCHIVE_DAYS, 10) || parseInt(config.threadArchiveDays, 10) || 7;
config.siteAdmins = String(process.env.SITE_ADMINS || config.siteAdmins || '')
  .split(',').map((s) => s.trim()).filter(Boolean);
// Only trust X-Forwarded-For when a reverse proxy (e.g. SWAG/nginx) sits in
// front; otherwise any client could spoof it to dodge the auth rate limits.
config.trustProxy = /^(1|true|yes|on)$/i.test(String(process.env.TRUST_PROXY || config.trustProxy || ''));
// Tests share one IP and register many users, so they run unthrottled.
config.rateLimit = process.env.NODE_ENV !== 'test';

// Seed the registration mode from env/config on first run; the DB is
// authoritative afterwards so the in-app admin panel can change it. Also apply
// any env-designated site admins.
if (!db.getSetting('registration_mode')) db.setSetting('registration_mode', config.registrationMode);
for (const name of config.siteAdmins) db.setSiteAdminByUsername(name, true);
function registrationMode() {
  return db.getSetting('registration_mode') || config.registrationMode || 'open';
}

// Security: never sign tokens with a guessable secret. Anything shorter than
// 32 characters, or a known placeholder (the docker-compose sample value,
// "changeme", "secret", ...), is refused.
const MIN_JWT_SECRET_LENGTH = 32;
const PLACEHOLDER_SECRET = /change[\s_-]*me|placeholder|your[\s_-]*secret|^(secret|password|jwt[\s_-]*secret|test(secret)?)$/i;
function isWeakSecret(secret) {
  if (typeof secret !== 'string') return true;
  const s = secret.trim();
  return s.length < MIN_JWT_SECRET_LENGTH || PLACEHOLDER_SECRET.test(s);
}

// Resolve the secret, in order of preference: an explicit JWT_SECRET /
// config.json value (if strong), a secret generated on a previous run, or a
// fresh one. The generated secret is written to a gitignored file so tokens
// survive restarts without ever committing a secret into a tracked file.
function resolveJwtSecret(candidate, secretFile) {
  if (!isWeakSecret(candidate)) return candidate.trim();
  if (candidate && candidate !== 'changeme') {
    console.warn(`[security] Ignoring JWT_SECRET: it must be at least ${MIN_JWT_SECRET_LENGTH} characters and not a placeholder. Generate one with: openssl rand -hex 48`);
  }
  try {
    const saved = fs.readFileSync(secretFile, 'utf8').trim();
    if (!isWeakSecret(saved)) return saved;
  } catch (e) {
    /* no previously generated secret; fall through to create one */
  }
  const generated = crypto.randomBytes(48).toString('hex');
  try {
    fs.writeFileSync(secretFile, generated, { mode: 0o600 });
    console.warn(`[security] Generated a new JWT secret and saved it to ${secretFile}`);
  } catch (e) {
    console.warn('[security] Generated an ephemeral JWT secret (could not persist):', e.message);
  }
  return generated;
}
config.jwtSecret = resolveJwtSecret(config.jwtSecret, SECRET_FILE);

module.exports = { config, registrationMode, isWeakSecret, resolveJwtSecret, SECRET_FILE, MIN_JWT_SECRET_LENGTH };
