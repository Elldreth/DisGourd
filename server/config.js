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
// P11-05: the live setting lives in net/clientIp (TRUST_PROXY, TRUSTED_PROXIES,
// CLIENT_IP_HEADER); config.trustProxy reads and writes it.
const { proxyTrust } = require('./net/clientIp');
if (/^(1|true|yes|on)$/i.test(String(config.trustProxy || ''))) proxyTrust.enabled = true; // config.json
Object.defineProperty(config, 'trustProxy', {
  enumerable: true,
  get: () => proxyTrust.enabled,
  set: (on) => { proxyTrust.enabled = !!on; },
});
// Tests share one IP and register many users, so they run unthrottled.
config.rateLimit = process.env.NODE_ENV !== 'test';

// Seed the registration mode from env/config on first run; the DB is
// authoritative afterwards so the in-app admin panel can change it.
if (!db.getSetting('registration_mode')) db.setSetting('registration_mode', config.registrationMode);

// SITE_ADMINS (P11-01): each listed name is looked at once. An account that
// exists then is promoted; a name nobody has yet is remembered as missing and
// never promoted later (a stranger could register it on an open server and
// become admin at the next restart). A site admin demoted in the app stays
// demoted. Either way, Settings → Registration & access makes someone admin.
function applySiteAdmins(names) {
  let seen = {};
  try {
    seen = JSON.parse(db.getSetting('site_admins_seen') || '{}') || {};
  } catch {
    seen = {};
  }
  for (const name of names) {
    const user = db.getUserByUsername(name);
    if (seen[name] === 'missing' && user && !user.site_admin) {
      console.warn(`[security] SITE_ADMINS lists "${name}", but that account was created after the name was listed, so it isn't made a site admin automatically. If it's yours, make it one in Settings → Registration & access.`);
    }
    if (seen[name]) continue;
    if (user) {
      db.setSiteAdminByUsername(name, true);
      seen[name] = 'applied';
    } else {
      console.warn(`[security] SITE_ADMINS lists "${name}", but there's no such account. It won't be promoted when someone registers that name; make it a site admin in Settings → Registration & access instead.`);
      seen[name] = 'missing';
    }
  }
  db.setSetting('site_admins_seen', JSON.stringify(seen));
}
applySiteAdmins(config.siteAdmins);
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

// ---- First-run setup code (P11-01) ----
// On an instance with no accounts, the first registration becomes site admin
// whatever the registration mode, so it needs a one-time code that only the
// operator can see: SETUP_CODE, or one generated into .setup-code (0600) next
// to the JWT secret and printed at start. Tests run without it unless they
// set REQUIRE_SETUP_CODE=1.
const SETUP_CODE_FILE = process.env.SETUP_CODE_FILE || path.join(path.dirname(SECRET_FILE), '.setup-code');
config.requireSetupCode = process.env.NODE_ENV !== 'test' || /^(1|true|yes|on)$/i.test(String(process.env.REQUIRE_SETUP_CODE || ''));
let setupCodeValue = null;

// The code while the instance is empty (creating it if needed), else null.
function ensureSetupCode() {
  if (!config.requireSetupCode || db.countUsers() > 0) {
    setupCodeValue = null;
    return null;
  }
  const fromEnv = String(process.env.SETUP_CODE || '').trim();
  if (fromEnv) return (setupCodeValue = fromEnv);
  try {
    const saved = fs.readFileSync(SETUP_CODE_FILE, 'utf8').trim();
    if (saved.length >= 12) return (setupCodeValue = saved);
  } catch {
    /* none yet */
  }
  const generated = crypto.randomBytes(12).toString('base64url');
  try {
    fs.writeFileSync(SETUP_CODE_FILE, generated, { mode: 0o600 });
  } catch (e) {
    console.warn('[security] Could not save the setup code (it is only in this log):', e.message);
  }
  return (setupCodeValue = generated);
}

// Whether `provided` is the current setup code (constant time).
function checkSetupCode(provided) {
  const code = setupCodeValue || ensureSetupCode();
  if (!code || typeof provided !== 'string') return false;
  const a = Buffer.from(provided.trim());
  const b = Buffer.from(code);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// The first account exists: the code is spent.
function clearSetupCode() {
  setupCodeValue = null;
  fs.rmSync(SETUP_CODE_FILE, { force: true });
}

ensureSetupCode();

module.exports = {
  config, registrationMode, isWeakSecret, resolveJwtSecret, SECRET_FILE, MIN_JWT_SECRET_LENGTH,
  applySiteAdmins, ensureSetupCode, checkSetupCode, clearSetupCode, SETUP_CODE_FILE,
};
