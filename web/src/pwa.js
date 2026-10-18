// Service worker registration and the "update available" flow (P2-18a).
//
// registerServiceWorker({ onUpdate }) registers /sw.js (production builds
// only, and only where service workers exist). When a new worker has been
// installed behind the running one, `onUpdate(apply)` is called; `apply()`
// tells the waiting worker to take over, and the page reloads once it has.
// Returns a promise of the registration, or null when nothing was done.
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
