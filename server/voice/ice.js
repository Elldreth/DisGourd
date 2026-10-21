// ICE servers for voice and video calls (P11-11). Calls are a mesh: without a
// relay, everyone in a call learns everyone else's public address, and people
// behind strict NATs can't connect. In order of preference:
//
//   Cloudflare TURN (owner decision 3): TURN_KEY_ID + TURN_KEY_TOKEN (or
//     TURN_KEY_TOKEN_FILE). Short-lived credentials per person from
//     Cloudflare's API; its answer already includes its STUN server.
//   coturn: TURN_URLS + TURN_SECRET (or TURN_SECRET_FILE), the TURN REST
//     scheme: username `<expiry>:<userId>`, credential HMAC-SHA1(secret).
//   Otherwise STUN only (STUN_URLS, or Google's public one), as before.
//
// VOICE_RELAY_ONLY=1 asks clients to use only the relay (hides addresses from
// each other completely), but only when there is a relay; off by default.
const crypto = require('crypto');
const { secretFromEnv } = require('../secrets');

const DEFAULT_STUN = ['stun:stun.l.google.com:19302'];
const TTL_SECONDS = 12 * 60 * 60; // the longest call we expect
const CF_API = 'https://rtc.live.cloudflare.com/v1/turn/keys';
const CF_TIMEOUT_MS = 5000;
const CACHE_MAX = 1000;

let fetchImpl = (...args) => fetch(...args);
const cache = new Map(); // userId -> { value, renewAt } (Cloudflare answers)
let warnedAt = 0;

const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
const on = (v) => /^(1|true|yes|on)$/i.test(String(v || '').trim());

function stunServers(env) {
  const urls = list(env.STUN_URLS);
  return [{ urls: urls.length ? urls : DEFAULT_STUN }];
}

function warnOnce(message) {
  if (Date.now() - warnedAt < 60 * 60 * 1000) return; // at most hourly
  warnedAt = Date.now();
  console.warn(message);
}

async function fromCloudflare(userId, keyId, keyToken, now) {
  const hit = cache.get(userId);
  if (hit && now < hit.renewAt) return hit.value;
  const res = await fetchImpl(`${CF_API}/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${keyToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttl: TTL_SECONDS }),
    signal: AbortSignal.timeout(CF_TIMEOUT_MS),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || !Array.isArray(body.iceServers) || !body.iceServers.length) {
    throw new Error(`answered ${res.status}`);
  }
  const value = { iceServers: body.iceServers, expiresAt: now + TTL_SECONDS * 1000 };
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  // Hand out the same credentials for half their life, then ask again.
  cache.set(userId, { value, renewAt: now + (TTL_SECONDS * 1000) / 2 });
  return value;
}

function fromCoturn(userId, urls, secret, now) {
  const expiry = Math.floor(now / 1000) + TTL_SECONDS;
  const username = `${expiry}:${userId}`;
  const credential = crypto.createHmac('sha1', secret).update(username).digest('base64');
  return { iceServers: [{ urls, username, credential }], expiresAt: expiry * 1000 };
}

// { iceServers, relayOnly, expiresAt } for one signed-in person.
async function iceFor(userId, { env = process.env, now = Date.now() } = {}) {
  const stun = stunServers(env);
  const relayOnly = on(env.VOICE_RELAY_ONLY);
  const keyId = String(env.TURN_KEY_ID || '').trim();
  if (keyId) {
    try {
      const cf = await fromCloudflare(userId, keyId, secretFromEnv('TURN_KEY_TOKEN', env), now);
      return { iceServers: cf.iceServers, relayOnly, expiresAt: cf.expiresAt };
    } catch (err) {
      warnOnce(`[voice] Cloudflare TURN credentials failed (${err.message}); calls use STUN only until it works`);
      return { iceServers: stun, relayOnly: false, expiresAt: null };
    }
  }
  const turnUrls = list(env.TURN_URLS);
  const secret = secretFromEnv('TURN_SECRET', env);
  if (turnUrls.length && secret) {
    const turn = fromCoturn(userId, turnUrls, secret, now);
    return { iceServers: [...stun, ...turn.iceServers], relayOnly, expiresAt: turn.expiresAt };
  }
  // No relay: relay-only would leave nobody able to connect.
  return { iceServers: stun, relayOnly: false, expiresAt: null };
}

// At start: a *_FILE that can't be read stops the server here (P11-14),
// rather than at someone's first call.
function checkConfig(env = process.env) {
  if (env.TURN_KEY_ID) secretFromEnv('TURN_KEY_TOKEN', env);
  if (env.TURN_URLS) secretFromEnv('TURN_SECRET', env);
}

module.exports = {
  iceFor,
  checkConfig,
  TTL_SECONDS,
  _setFetch: (f) => { fetchImpl = f; },
  _reset: () => { cache.clear(); warnedAt = 0; fetchImpl = (...args) => fetch(...args); },
};
