/* DisGourd service worker (P2-18a).
 *
 * Hand-written, no build step beyond stamping the build id below, so every
 * deploy installs a fresh worker. It makes the app installable and usable
 * offline as a shell:
 *   - navigations: network first, then the cached /offline.html
 *   - /assets/*: cache first (Vite fingerprints them)
 *   - the shell files (manifest, icons, theme-init, offline page): precached,
 *     refreshed network first
 * Everything else (/spaces, /dms, /uploads, /media, /gateway, sign-in, …) is
 * left to the network untouched, so nothing private is ever cached here.
 */
const BUILD = '__BUILD__';
const CACHE = `disgourd-${BUILD}`;
const OFFLINE_URL = '/offline.html';
const SHELL = [OFFLINE_URL, '/manifest.json', '/icon-192.png', '/icon-512.png', '/favicon.svg', '/favicon-32.png', '/apple-touch-icon.png', '/theme-init.js'];

// What this worker answers for a same-origin GET: 'navigate', 'asset',
// 'shell' or null (leave it to the network).
function routeFor(request, origin) {
  if (request.method !== 'GET') return null;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  if (request.mode === 'navigate') return 'navigate';
  if (url.pathname.startsWith('/assets/')) return 'asset';
  if (SHELL.includes(url.pathname)) return 'shell';
  return null;
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('disgourd-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// A push from the server (an @mention or a DM while no tab was open): show it.
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'DisGourd' };
  }
  const data = payload.data || {};
  const tag = data.dm ? `dm:${data.dm}` : `ch:${data.space}:${data.channel}`;
  event.waitUntil(
    self.registration.showNotification(payload.title || 'DisGourd', {
      body: payload.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag,
      data,
    })
  );
});

// Clicking it: bring an open DisGourd tab to the front and ask it to open
// the place, or open a new one at /?open=… (the app reads that once).
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const client = list.find((c) => 'focus' in c);
      if (client) {
        client.postMessage({ type: 'OPEN', data });
        return client.focus();
      }
      return self.clients.openWindow(`/?open=${encodeURIComponent(JSON.stringify(data))}`);
    })
  );
});

// The page asks a waiting worker to take over (the "Reload" in the update toast).
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const route = routeFor(event.request, self.location.origin);
  if (!route) return;
  if (route === 'asset') {
    event.respondWith(cacheFirst(event.request));
  } else if (route === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE_URL)));
  } else {
    event.respondWith(networkFirst(event.request));
  }
});

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(request);
    if (hit) return hit;
    throw err;
  }
}

// For the unit test (never used by the browser).
if (typeof module !== 'undefined') module.exports = { routeFor, SHELL };
