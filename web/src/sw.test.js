import { expect, test } from 'vitest';
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
