// Web Push (P2-18b): a notification for an @mention or a DM when the person
// has no open socket. VAPID keys come from the environment, else are generated
// once and kept next to the JWT secret (`.vapid.json`); tests get an
// ephemeral pair.
const path = require('path');
const fs = require('fs');
const webpush = require('web-push');
const db = require('./db');
const { SECRET_FILE } = require('./config');
const { secretFromEnv } = require('./secrets');
const { userClients } = require('./gateway/delivery');
const pushHosts = require('./net/pushHosts');

const KEYS_FILE = process.env.VAPID_KEYS_FILE || path.join(path.dirname(SECRET_FILE), '.vapid.json');
const CONTACT = process.env.VAPID_CONTACT || 'mailto:admin@disgourd.local';
const PREVIEW_LENGTH = 100;

// P11-14: VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY (or VAPID_PRIVATE_KEY_FILE)
// win over the file. Both or neither: one alone stops the start.
function vapidFromEnv(env = process.env) {
  const publicKey = secretFromEnv('VAPID_PUBLIC_KEY', env);
  const privateKey = secretFromEnv('VAPID_PRIVATE_KEY', env);
  if (!publicKey && !privateKey) return null;
  if (!publicKey || !privateKey) {
    throw new Error('[push] Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY (or VAPID_PRIVATE_KEY_FILE) both, or neither. Only one is set');
  }
  return { publicKey, privateKey };
}

function loadKeys({
  env = process.env,
  file = KEYS_FILE,
  ephemeral = process.env.NODE_ENV === 'test' || !process.env.DB_PATH || process.env.DB_PATH === ':memory:',
} = {}) {
  const fromEnv = vapidFromEnv(env);
  if (fromEnv) return fromEnv;
  if (!ephemeral) {
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (saved.publicKey && saved.privateKey) return saved;
    } catch {
      /* none yet */
    }
  }
  const keys = webpush.generateVAPIDKeys();
  if (!ephemeral) {
    try {
      fs.writeFileSync(file, JSON.stringify(keys), { mode: 0o600 });
      console.warn(`[push] Generated VAPID keys and saved them to ${file}`);
    } catch (err) {
      console.warn('[push] Generated ephemeral VAPID keys (could not persist):', err.message);
    }
  }
  return keys;
}

const keys = loadKeys();
webpush.setVapidDetails(CONTACT, keys.publicKey, keys.privateKey);

const publicKey = () => keys.publicKey;

// P11-10: subscriptions saved before the allowlist that point anywhere but a
// real push service are dropped once, at start.
const pruned = pushHosts.pruneSubscriptions(db);
if (pruned) console.warn(`[push] Removed ${pruned} push subscription(s) that weren't for a known push service`);

// The first 100 characters of a message, markdown markers and spoilers out.
function preview(content, attachments = []) {
  let text = String(content || '')
    .replace(/```[\s\S]*?```/g, ' [code] ')
    .replace(/\|\|[\s\S]+?\|\|/g, 'Spoiler')
    .replace(/(\*\*|__|~~|`)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const n = attachments.length;
  if (n && !text) text = n === 1 ? 'Sent an attachment' : `Sent ${n} attachments`;
  return text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH - 1)}…` : text;
}

// Send `{ title, body, data }` to every subscription of `userId`, but only
// when they have no open socket and aren't in Do Not Disturb. The body is
// left out for subscriptions that opted out of previews. Dead subscriptions
// (the push service answers 404 or 410) are removed. Resolves to how many
// pushes were attempted.
async function notifyIfAway(userId, { title, body, data }) {
  if (userClients[userId] && userClients[userId].size > 0) return 0;
  if (db.getUserPresence(userId) === 'dnd') return 0;
  const subs = db.getPushSubscriptions(userId);
  let sent = 0;
  await Promise.all(
    subs.map(async (sub) => {
      // P11-10: only listed push services, and only while their addresses are public.
      if (!pushHosts.allowedPushEndpoint(sub.endpoint)) {
        db.deletePushEndpoint(sub.endpoint);
        return;
      }
      if (!(await pushHosts.endpointAddressesOk(sub.endpoint))) return;
      const payload = JSON.stringify({ title, body: sub.previews ? body : undefined, data });
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, { TTL: 60 * 60 });
        sent += 1;
      } catch (err) {
        if (err && (err.statusCode === 404 || err.statusCode === 410)) db.deletePushEndpoint(sub.endpoint);
        else console.warn('[push] Could not send a notification:', err && err.message);
      }
    })
  );
  return sent;
}

module.exports = { publicKey, notifyIfAway, preview, PREVIEW_LENGTH, KEYS_FILE, loadKeys, vapidFromEnv };
