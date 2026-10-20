// P6-02: the API side of a password change — the fresh token is stored, and a
// "signed out" check made while the change is in flight waits for it, so the
// device that changed the password isn't signed out by its own change.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import * as api from './api.js';

const reply = (status, body) => ({ status, ok: status < 400, statusText: '', text: async () => JSON.stringify(body) });

beforeEach(() => {
  localStorage.clear();
  api.setToken('old.token');
});
afterEach(() => {
  vi.unstubAllGlobals();
  api.setUnauthorizedHandler(null);
});

test('a successful change stores the new token', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => reply(200, { token: 'new.token' })));
  await api.changePassword('old-password', 'new-password');
  expect(api.getToken()).toBe('new.token');
  const [url, init] = fetch.mock.calls[0];
  expect(url).toBe('/me/password');
  expect(JSON.parse(init.body)).toEqual({ currentPassword: 'old-password', newPassword: 'new-password' });
});

test('stillSignedIn waits for a change in flight, then checks with the new token', async () => {
  let finish;
  const seen = [];
  vi.stubGlobal('fetch', vi.fn((url, init) => {
    seen.push([url, init.headers.Authorization]);
    if (url === '/me/password') return new Promise((r) => { finish = () => r(reply(200, { token: 'new.token' })); });
    return Promise.resolve(init.headers.Authorization === 'Bearer new.token' ? reply(200, {}) : reply(401, { error: 'Unauthorized' }));
  }));
  const change = api.changePassword('old-password', 'new-password');
  const check = api.stillSignedIn(); // the signed_out frame beat the response
  await Promise.resolve();
  finish();
  await change;
  expect(await check).toBe(true);
  expect(seen.at(-1)).toEqual(['/me', 'Bearer new.token']);
  expect(api.getToken()).toBe('new.token');
});

test('on another device the check fails: the token is dropped and the app signs out', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => reply(401, { error: 'Unauthorized' })));
  const onUnauthorized = vi.fn();
  api.setUnauthorizedHandler(onUnauthorized);
  expect(await api.stillSignedIn()).toBe(false);
  expect(api.getToken()).toBe('');
  expect(onUnauthorized).toHaveBeenCalled();
});

// P9-03: signing out the other devices swaps this device's token the same way.
// A request that went out with the old token during the swap (the open devices
// list reloading on "sessions_changed") waits and retries, instead of signing
// this device out.
test('a request refused with the old token during a swap retries with the new one', async () => {
  let finish;
  const seen = [];
  vi.stubGlobal('fetch', vi.fn((url, init) => {
    seen.push([url, init.headers.Authorization]);
    if (url === '/me/sessions/sign-out-others') return new Promise((r) => { finish = () => r(reply(200, { token: 'new.token' })); });
    return Promise.resolve(init.headers.Authorization === 'Bearer new.token' ? reply(200, { sessions: [] }) : reply(401, { error: 'Unauthorized' }));
  }));
  const onUnauthorized = vi.fn();
  api.setUnauthorizedHandler(onUnauthorized);
  const swap = api.signOutOtherSessions();
  const list = api.getSessions(); // goes out with old.token and is refused
  await new Promise((r) => setTimeout(r, 0));
  finish();
  await swap;
  expect(await list).toEqual({ sessions: [] });
  expect(seen.filter(([u]) => u === '/me/sessions').map(([, a]) => a)).toEqual(['Bearer old.token', 'Bearer new.token']);
  expect(onUnauthorized).not.toHaveBeenCalled();
  expect(api.getToken()).toBe('new.token');
});

test('a refusal with no swap in flight still signs out, and only once', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => reply(401, { error: 'Unauthorized' })));
  const onUnauthorized = vi.fn();
  api.setUnauthorizedHandler(onUnauthorized);
  await expect(api.getSessions()).rejects.toThrow('Unauthorized');
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(onUnauthorized).toHaveBeenCalledTimes(1);
  expect(api.getToken()).toBe('');
});
