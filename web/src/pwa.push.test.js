import { afterEach, beforeEach, expect, test, vi } from 'vitest';

vi.mock('./api.js', () => ({
  getVapidKey: vi.fn(async () => ({ key: 'BAbC-d_e' })),
  savePushSubscription: vi.fn(async () => ({ ok: true })),
  deletePushSubscription: vi.fn(async () => ({ ok: true })),
}));
const api = await import('./api.js');
const { subscribeToPush, unsubscribeFromPush, urlBase64ToUint8Array, pushSupport, onOpenRequest, readOpenRequest } = await import('./pwa.js');

// A registration whose pushManager remembers one subscription.
function fakeContainer(existing = null) {
  const subs = { current: existing };
  const pushManager = {
    getSubscription: vi.fn(async () => subs.current),
    subscribe: vi.fn(async () => {
      subs.current = { endpoint: 'https://push.example/new', toJSON: () => ({ endpoint: 'https://push.example/new', keys: { p256dh: 'p', auth: 'a' } }), unsubscribe: vi.fn(async () => true) };
      return subs.current;
    }),
  };
  const listeners = {};
  return {
    container: { ready: Promise.resolve({ pushManager }), addEventListener: (t, fn) => (listeners[t] = fn), removeEventListener: vi.fn() },
    pushManager,
    subs,
    listeners,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('Notification', { permission: 'default', requestPermission: vi.fn(async () => 'granted') });
});
afterEach(() => vi.unstubAllGlobals());

test('the push service key decodes from URL-safe base64', () => {
  expect(Array.from(urlBase64ToUint8Array('AQID'))).toEqual([1, 2, 3]);
  expect(urlBase64ToUint8Array('-_8').length).toBe(2);
});

test('subscribing asks for permission, subscribes with the server key and saves it with the previews choice', async () => {
  const { container, pushManager } = fakeContainer();
  await subscribeToPush({ previews: false, container });
  expect(Notification.requestPermission).toHaveBeenCalled();
  expect(api.getVapidKey).toHaveBeenCalled();
  expect(pushManager.subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }));
  expect(api.savePushSubscription).toHaveBeenCalledWith({ endpoint: 'https://push.example/new', keys: { p256dh: 'p', auth: 'a' } }, false);
});

test('an existing subscription is re-saved (no new subscribe); denied permission is a readable error', async () => {
  const existing = { endpoint: 'https://push.example/old', toJSON: () => ({ endpoint: 'https://push.example/old', keys: { p256dh: 'p', auth: 'a' } }), unsubscribe: vi.fn(async () => true) };
  const { container, pushManager } = fakeContainer(existing);
  Notification.permission = 'granted';
  await subscribeToPush({ previews: true, container });
  expect(pushManager.subscribe).not.toHaveBeenCalled();
  expect(api.savePushSubscription).toHaveBeenCalledWith(expect.objectContaining({ endpoint: 'https://push.example/old' }), true);
  Notification.permission = 'default';
  Notification.requestPermission.mockResolvedValueOnce('denied');
  await expect(subscribeToPush({ container })).rejects.toThrow(/blocked/);
});

test('unsubscribing removes it on the server and in the browser', async () => {
  const existing = { endpoint: 'https://push.example/old', unsubscribe: vi.fn(async () => true) };
  const { container } = fakeContainer(existing);
  expect(await unsubscribeFromPush({ container })).toBe(true);
  expect(api.deletePushSubscription).toHaveBeenCalledWith('https://push.example/old');
  expect(existing.unsubscribe).toHaveBeenCalled();
  expect(await unsubscribeFromPush({ container: fakeContainer().container })).toBe(false);
});

test('pushSupport tells an iPhone in the browser to add the app to the Home Screen first', () => {
  const win = { PushManager: {}, Notification: {}, matchMedia: () => ({ matches: false }) };
  expect(pushSupport({ serviceWorker: {}, userAgent: 'Chrome' }, win)).toEqual({ supported: true, needsHomeScreen: false });
  expect(pushSupport({ serviceWorker: {}, userAgent: 'iPhone Safari' }, { matchMedia: () => ({ matches: false }) })).toEqual({ supported: false, needsHomeScreen: true });
  expect(pushSupport({ serviceWorker: {}, userAgent: 'iPhone Safari' }, { ...win, matchMedia: () => ({ matches: true }) })).toEqual({ supported: true, needsHomeScreen: false });
});

test('an open request comes from ?open= (read once and removed) or from the worker', () => {
  const history = { state: null, replaceState: vi.fn() };
  const loc = { search: `?open=${encodeURIComponent(JSON.stringify({ space: 'S', channel: 'general' }))}&x=1`, pathname: '/', hash: '' };
  expect(readOpenRequest(loc, history)).toEqual({ space: 'S', channel: 'general' });
  expect(history.replaceState).toHaveBeenCalledWith(null, '', '/?x=1');
  expect(readOpenRequest({ search: '?open=%7Bnot-json', pathname: '/', hash: '' }, history)).toBeNull();
  const { container, listeners } = fakeContainer();
  const cb = vi.fn();
  const stop = onOpenRequest(cb, { container, loc: { search: '', pathname: '/', hash: '' } });
  listeners.message({ data: { type: 'OPEN', data: { dm: 'bob' } } });
  listeners.message({ data: { type: 'other' } });
  expect(cb).toHaveBeenCalledTimes(1);
  expect(cb).toHaveBeenCalledWith({ dm: 'bob' });
  stop();
  expect(container.removeEventListener).toHaveBeenCalled();
});
