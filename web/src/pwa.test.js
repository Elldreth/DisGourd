import { expect, test, vi } from 'vitest';
import { registerServiceWorker } from './pwa.js';

// A stand-in for navigator.serviceWorker and a registration.
function fakeContainer({ controller = null, waiting = null } = {}) {
  const listeners = {};
  const reg = {
    waiting,
    installing: null,
    _listeners: {},
    addEventListener: (type, fn) => (reg._listeners[type] = fn),
  };
  const container = {
    controller,
    register: vi.fn(async () => reg),
    addEventListener: (type, fn) => (listeners[type] = fn),
    fire: (type) => listeners[type]?.(),
  };
  return { container, reg };
}
const fakeWorker = () => {
  const w = { state: 'installing', postMessage: vi.fn(), _on: null, addEventListener: (t, fn) => (w._on = fn) };
  return w;
};

test('does nothing when disabled or unsupported', async () => {
  expect(await registerServiceWorker({ enabled: false, container: fakeContainer().container })).toBeNull();
  expect(await registerServiceWorker({ enabled: true, container: undefined })).toBeNull();
});

test('registers /sw.js; a worker installed behind a running one offers the update, and applying it tells that worker to take over', async () => {
  const { container, reg } = fakeContainer({ controller: {} });
  const onUpdate = vi.fn();
  const reload = vi.fn();
  await registerServiceWorker({ enabled: true, container, onUpdate, reload });
  expect(container.register).toHaveBeenCalledWith('/sw.js');
  const worker = fakeWorker();
  reg.installing = worker;
  reg._listeners.updatefound();
  worker.state = 'installed';
  worker._on();
  expect(onUpdate).toHaveBeenCalledTimes(1);
  onUpdate.mock.calls[0][0](); // the Reload action
  expect(worker.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
  container.fire('controllerchange');
  container.fire('controllerchange');
  expect(reload).toHaveBeenCalledTimes(1); // once, not on every change
});

test('a first install (no controller yet) is not an update; a worker already waiting is', async () => {
  const first = fakeContainer({ controller: null });
  const onUpdate = vi.fn();
  await registerServiceWorker({ enabled: true, container: first.container, onUpdate, reload: () => {} });
  const worker = fakeWorker();
  first.reg.installing = worker;
  first.reg._listeners.updatefound();
  worker.state = 'installed';
  worker._on();
  expect(onUpdate).not.toHaveBeenCalled();

  const waiting = { postMessage: vi.fn() };
  const second = fakeContainer({ controller: {}, waiting });
  await registerServiceWorker({ enabled: true, container: second.container, onUpdate, reload: () => {} });
  expect(onUpdate).toHaveBeenCalledTimes(1);
  onUpdate.mock.calls[0][0]();
  expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
});
