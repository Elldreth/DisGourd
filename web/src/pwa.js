// The installable shell (P2-18a) and Web Push (P2-18b).
//
// registerServiceWorker({ onUpdate }) registers /sw.js (production builds
// only, and only where service workers exist). When a new worker has been
// installed behind the running one, `onUpdate(apply)` is called; `apply()`
// tells the waiting worker to take over, and the page reloads once it has.
// Returns a promise of the registration, or null when nothing was done.
import * as api from './api.js';

export function registerServiceWorker({
  onUpdate,
  enabled = import.meta.env.PROD,
  container = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined,
  reload = () => window.location.reload(),
} = {}) {
  if (!enabled || !container) return Promise.resolve(null);
  let reloading = false;
  container.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    reload();
  });
  return container
    .register('/sw.js')
    .then((reg) => {
      const watch = (worker) => {
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          // "installed" with a controller already in charge means a new version
          // is waiting; without one it's the first install (nothing to say).
          if (worker.state === 'installed' && container.controller) onUpdate?.(() => worker.postMessage({ type: 'SKIP_WAITING' }));
        });
      };
      if (reg.waiting && container.controller) onUpdate?.(() => reg.waiting.postMessage({ type: 'SKIP_WAITING' }));
      reg.addEventListener('updatefound', () => watch(reg.installing));
      return reg;
    })
    .catch(() => null);
}

// ---- Web Push ----

// Whether this browser can do push at all, and whether it's an iPhone/iPad
// that still needs the app on the Home Screen first (Safari's rule).
export function pushSupport(nav = typeof navigator !== 'undefined' ? navigator : {}, win = typeof window !== 'undefined' ? window : {}) {
  const supported = !!(nav.serviceWorker && 'PushManager' in win && 'Notification' in win);
  const ios = /iPhone|iPad|iPod/.test(nav.userAgent || '') || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
  const standalone = !!(win.matchMedia && win.matchMedia('(display-mode: standalone)').matches) || nav.standalone === true;
  return { supported, needsHomeScreen: ios && !standalone && !supported };
}

// The push service's key as the bytes subscribe() wants.
export function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

const ready = (container) => (container.ready ? container.ready : container.getRegistration().then((r) => r));

// This browser's current subscription, or null.
export async function getPushSubscription({ container = navigator.serviceWorker } = {}) {
  const reg = await ready(container);
  return reg?.pushManager ? reg.pushManager.getSubscription() : null;
}

// Subscribe this browser (asking for notification permission if needed) and
// save it on the server with the previews choice. Throws with a readable
// message when it can't.
export async function subscribeToPush({ previews = true, container = navigator.serviceWorker, requestPermission = () => Notification.requestPermission() } = {}) {
  const permission = Notification.permission === 'granted' ? 'granted' : await requestPermission();
  if (permission !== 'granted') throw new Error(permission === 'denied' ? 'Notifications are blocked for this site' : 'Notifications were not allowed');
  const reg = await ready(container);
  if (!reg?.pushManager) throw new Error('This browser cannot receive push notifications');
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const { key } = await api.getVapidKey();
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) });
  }
  await api.savePushSubscription(sub.toJSON ? sub.toJSON() : sub, previews);
  return sub;
}

// Remove this browser's subscription here and on the server.
export async function unsubscribeFromPush({ container = navigator.serviceWorker } = {}) {
  const sub = await getPushSubscription({ container });
  if (!sub) return false;
  await api.deletePushSubscription(sub.endpoint).catch(() => {});
  await sub.unsubscribe();
  return true;
}

// Something to open because a notification was clicked: a `?open=…` in the
// address bar when the app starts (read once and removed), or an OPEN message
// from the worker to this tab. `cb(data)` gets { dm } or { space, channel, thread? }.
// Returns a function that stops listening.
export function onOpenRequest(cb, { container = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined, loc = typeof window !== 'undefined' ? window.location : null } = {}) {
  const fromUrl = readOpenRequest(loc);
  if (fromUrl) cb(fromUrl);
  if (!container) return () => {};
  const onMessage = (e) => {
    if (e.data && e.data.type === 'OPEN') cb(e.data.data);
  };
  container.addEventListener('message', onMessage);
  return () => container.removeEventListener('message', onMessage);
}

// The ?open=… in the address bar, parsed and removed; null if none.
export function readOpenRequest(loc = window.location, history = typeof window !== 'undefined' ? window.history : null) {
  if (!loc) return null;
  const params = new URLSearchParams(loc.search);
  const raw = params.get('open');
  if (!raw) return null;
  let data = null;
  try {
    data = JSON.parse(raw);
  } catch {
    data = null;
  }
  params.delete('open');
  const search = params.toString();
  history?.replaceState?.(history.state, '', loc.pathname + (search ? `?${search}` : '') + loc.hash);
  return data && typeof data === 'object' ? data : null;
}
