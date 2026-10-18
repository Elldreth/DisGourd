// Web Push (P2-18b): a notification for an @mention or a DM when the person
// has no open socket. VAPID keys are generated once and kept next to the JWT
// secret (`.vapid.json`); tests get an ephemeral pair.
const path = require('path');
const fs = require('fs');
const webpush = require('web-push');
const db = require('./db');
const { SECRET_FILE } = require('./config');
const { userClients } = require('./gateway/delivery');

const KEYS_FILE = process.env.VAPID_KEYS_FILE || path.join(path.dirname(SECRET_FILE), '.vapid.json');
const CONTACT = process.env.VAPID_CONTACT || 'mailto:admin@disgourd.local';
const PREVIEW_LENGTH = 100;

function loadKeys() {
  const ephemeral = process.env.NODE_ENV === 'test' || !process.env.DB_PATH || process.env.DB_PATH === ':memory:';
  if (!ephemeral) {
    try {
      const saved = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
      if (saved.publicKey && saved.privateKey) return saved;
    } catch {
      /* none yet */
    }
  }
  const keys = webpush.generateVAPIDKeys();
  if (!ephemeral) {
    try {
      fs.writeFileSync(KEYS_FILE, JSON.stringify(keys), { mode: 0o600 });
      console.warn(`[push] Generated VAPID keys and saved them to ${KEYS_FILE}`);
    } catch (err) {
      console.warn('[push] Generated ephemeral VAPID keys (could not persist):', err.message);
    }
  }
  return keys;
}

const keys = loadKeys();
webpush.setVapidDetails(CONTACT, keys.publicKey, keys.privateKey);

const publicKey = () => keys.publicKey;

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

module.exports = { publicKey, notifyIfAway, preview, PREVIEW_LENGTH, KEYS_FILE };
