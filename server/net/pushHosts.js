// Which push services the server will deliver to (P11-10).
//
// A push subscription's endpoint comes from the browser, but nothing stops a
// member from saving any URL as "their endpoint" and then getting themselves
// @mentioned: the server would POST to it. On a home server that means the
// router, the NAS's web UI or another container. So only the real push
// services are accepted, and the address is checked again before each send.
//
//   allowedPushEndpoint(url, env?) -> true for https on 443 to a listed host
//   endpointAddressesOk(url)       -> Promise<bool>: every resolved address public
//   pruneSubscriptions(db)         -> how many saved rows were not allowed (deleted)
//   setLookup(fn)                  -> tests: replace DNS (and clear the cache)

const dns = require('dns');
const net = require('net');
const { isBlockedAddress } = require('./safeFetch');

// Chrome / Android / Edge on Android, Firefox, Edge on Windows, Safari / iOS.
const BUILT_IN_HOSTS = [
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  '*.push.services.mozilla.com',
  '*.notify.windows.com',
  'web.push.apple.com',
];
const CHECK_TTL_MS = 10 * 60 * 1000; // how long a host's DNS check is trusted

function hostRules(env = process.env) {
  const extra = String(env.PUSH_HOSTS_EXTRA || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return [...BUILT_IN_HOSTS, ...extra];
}

// "*.example.com" matches subdomains only; anything else must match exactly.
function hostMatches(host, rule) {
  if (rule.startsWith('*.')) {
    const suffix = rule.slice(1); // ".example.com"
    return host.length > suffix.length && host.endsWith(suffix);
  }
  return host === rule;
}

function allowedPushEndpoint(endpoint, env = process.env) {
  let u;
  try {
    u = new URL(String(endpoint));
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username || u.password) return false;
  if (u.port && u.port !== '443') return false;
  const host = u.hostname.toLowerCase();
  if (net.isIP(host.replace(/^\[|\]$/g, ''))) return false;
  return hostRules(env).some((rule) => hostMatches(host, rule));
}

let lookup = (host) => dns.promises.lookup(host, { all: true, verbatim: true });
const checked = new Map(); // host -> { ok, at }
const warned = new Set();

function warnOnce(host, why) {
  if (warned.has(host)) return;
  warned.add(host);
  console.warn(`[push] Not sending to ${host}: ${why}`);
}

// Resolve the endpoint's host; refuse it when DNS fails or any address is
// private, loopback, link-local or otherwise not on the public internet.
async function endpointAddressesOk(endpoint) {
  let host;
  try {
    host = new URL(String(endpoint)).hostname.toLowerCase();
  } catch {
    return false;
  }
  const hit = checked.get(host);
  if (hit && Date.now() - hit.at < CHECK_TTL_MS) return hit.ok;
  let ok = false;
  let why = 'it resolves to a private or reserved address';
  try {
    const addresses = await lookup(host);
    ok = Array.isArray(addresses) && addresses.length > 0 && addresses.every((a) => !isBlockedAddress(a.address));
  } catch (err) {
    why = `DNS failed (${err.message})`;
  }
  if (!ok) warnOnce(host, why);
  // A DNS failure isn't remembered, so the next push tries again.
  if (ok || why.startsWith('it resolves')) checked.set(host, { ok, at: Date.now() });
  return ok;
}

// Delete saved subscriptions that point anywhere but a listed push service
// (rows from before P11-10). Returns how many went.
function pruneSubscriptions(db, env = process.env) {
  const rows = db.raw.prepare('SELECT endpoint FROM push_subscriptions').all();
  let removed = 0;
  for (const { endpoint } of rows) {
    if (!allowedPushEndpoint(endpoint, env) && db.deletePushEndpoint(endpoint)) removed += 1;
  }
  return removed;
}

function setLookup(fn) {
  lookup = fn;
  checked.clear();
  warned.clear();
}

module.exports = { allowedPushEndpoint, endpointAddressesOk, pruneSubscriptions, setLookup, BUILT_IN_HOSTS };
