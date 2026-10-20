import { expect, test, vi } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import path from 'path';

// The service worker is a plain script: run it in a stand-in worker scope
// (a `self` that records listeners, no real caches) and take its helpers.
const source = readFileSync(path.resolve(__dirname, '..', 'sw.js'), 'utf8');
const self = { location: { origin: 'https://chat.example' }, addEventListener: () => {} };
const mod = { exports: {} };
new Function('self', 'caches', 'fetch', 'module', source)(self, undefined, undefined, mod);
const { routeFor, SHELL } = mod.exports;

const ORIGIN = 'https://chat.example';
const req = (p, over = {}) => ({ method: 'GET', url: `${ORIGIN}${p}`, mode: 'cors', ...over });

test('the worker answers navigations, fingerprinted assets and the shell files, and nothing else', () => {
  expect(routeFor(req('/', { mode: 'navigate' }), ORIGIN)).toBe('navigate');
  expect(routeFor(req('/invite/abc', { mode: 'navigate' }), ORIGIN)).toBe('navigate');
  expect(routeFor(req('/assets/index-abc123.js'), ORIGIN)).toBe('asset');
  expect(routeFor(req('/manifest.json'), ORIGIN)).toBe('shell');
  expect(routeFor(req('/offline.html'), ORIGIN)).toBe('shell');
  for (const p of ['/spaces', '/spaces/S/channels/general/messages', '/dms', '/uploads/x/y.png', '/media/proxy?u=1', '/me', '/search?q=x', '/admin/registration']) {
    expect(routeFor(req(p), ORIGIN)).toBeNull();
  }
  expect(routeFor(req('/assets/x.js', { method: 'POST' }), ORIGIN)).toBeNull();
  expect(routeFor({ method: 'GET', url: 'https://elsewhere.example/assets/x.js', mode: 'cors' }, ORIGIN)).toBeNull();
  expect(SHELL).toContain('/offline.html');
});

test('the built worker carries a build id (so every deploy is a new worker)', () => {
  const built = path.resolve(__dirname, '..', 'dist', 'sw.js');
  if (!existsSync(built)) return; // only after `vite build`
  const text = readFileSync(built, 'utf8');
  expect(text).not.toContain("'__BUILD__'");
  expect(text).toMatch(/const BUILD = '[a-z0-9]{6,}';/);
});

// The worker's push handlers (P2-18b), run against a recording scope.
function workerScope() {
  const listeners = {};
  const scope = {
    location: { origin: 'https://chat.example' },
    addEventListener: (type, fn) => (listeners[type] = fn),
    registration: { showNotification: vi.fn(async () => {}) },
    clients: { matchAll: vi.fn(async () => []), openWindow: vi.fn(async () => {}) },
  };
  new Function('self', 'caches', 'fetch', 'module', source)(scope, undefined, undefined, { exports: {} });
  return { scope, listeners };
}
const event = (extra) => ({ waitUntil: (p) => (event.last = p), ...extra });

test('a push shows a notification from the payload, grouped per conversation', async () => {
  const { scope, listeners } = workerScope();
  listeners.push(event({ data: { json: () => ({ title: 'bob in #general · S', body: 'hi', data: { space: 'S', channel: 'general' } }) } }));
  await event.last;
  expect(scope.registration.showNotification).toHaveBeenCalledWith('bob in #general · S', expect.objectContaining({ body: 'hi', tag: 'ch:S:general', icon: '/icon-192.png', data: { space: 'S', channel: 'general' } }));
  listeners.push(event({ data: { json: () => ({ title: 'bob', data: { dm: 'bob', conversation: 7 } }) } }));
  await event.last;
  expect(scope.registration.showNotification).toHaveBeenLastCalledWith('bob', expect.objectContaining({ body: '', tag: 'dm:c:7' })); // P9-06b: per conversation
  listeners.push(event({ data: { json: () => ({ title: 'bob', data: { dm: 'bob' } }) } })); // a push from before P9-06a
  await event.last;
  expect(scope.registration.showNotification).toHaveBeenLastCalledWith('bob', expect.objectContaining({ tag: 'dm:@bob' }));
});

test('clicking it focuses an open tab and tells it where to go, or opens the app at ?open=', async () => {
  const { scope, listeners } = workerScope();
  const tab = { focus: vi.fn(async () => {}), postMessage: vi.fn() };
  scope.clients.matchAll.mockResolvedValueOnce([tab]);
  const notification = { close: vi.fn(), data: { dm: 'bob' } };
  listeners.notificationclick(event({ notification }));
  await event.last;
  expect(notification.close).toHaveBeenCalled();
  expect(tab.postMessage).toHaveBeenCalledWith({ type: 'OPEN', data: { dm: 'bob' } });
  expect(tab.focus).toHaveBeenCalled();
  listeners.notificationclick(event({ notification: { close: () => {}, data: { space: 'S', channel: 'general' } } }));
  await event.last;
  expect(scope.clients.openWindow).toHaveBeenCalledWith(`/?open=${encodeURIComponent(JSON.stringify({ space: 'S', channel: 'general' }))}`);
});
