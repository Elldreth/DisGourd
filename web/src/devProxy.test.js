// The dev server must forward every top-level API path the client calls (and
// that the server answers), or `npm run dev` gets index.html instead of JSON.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { apiPaths, proxyKey } from '../devProxy.js';

const webSrc = dirname(fileURLToPath(import.meta.url));
const serverRoutes = join(webSrc, '..', '..', 'server', 'routes');
// Folders in web/public (the UI sounds, P5-06) are files Vite serves itself, not API paths.
const publicPaths = readdirSync(join(webSrc, '..', 'public'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => `/${e.name}`);

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.jsx?$/.test(entry.name) && !/\.test\.jsx?$/.test(entry.name) ? [path] : [];
  });
}

// First segment of every same-origin URL the client sends a request to:
// request('/x…'), fetch('/x…') and xhr.open('POST', '/x…'), in any quote style.
function clientPaths() {
  const call = /\b(?:request|fetch|\.open\(\s*['"][A-Z]+['"]\s*,)\s*\(?\s*['"`]\/([a-z-]+)/g;
  const found = new Set();
  for (const file of sourceFiles(webSrc)) {
    for (const match of readFileSync(file, 'utf8').matchAll(call)) found.add(`/${match[1]}`);
  }
  return [...found].filter((p) => !publicPaths.includes(p)).sort();
}

// Top-level segments the server's route modules dispatch on.
function serverPaths() {
  const found = new Set();
  for (const file of sourceFiles(serverRoutes)) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/pathSegments\[0\] === '([a-z-]+)'/g)) found.add(`/${match[1]}`);
    for (const match of text.matchAll(/(?:pathname|path) === '\/([a-z-]+)'/g)) found.add(`/${match[1]}`);
    for (const match of text.matchAll(/startsWith\('\/([a-z-]+)/g)) found.add(`/${match[1]}`);
  }
  return [...found].sort();
}

const proxied = (url) => apiPaths.some((p) => new RegExp(proxyKey(p)).test(url));

describe('dev proxy', () => {
  it('forwards every top-level path the client calls', () => {
    const paths = clientPaths();
    expect(paths).toEqual(expect.arrayContaining(['/me', '/spaces', '/dms', '/search', '/invites']));
    expect(paths.filter((p) => !apiPaths.includes(p))).toEqual([]);
  });

  it('forwards every top-level path the server routes answer', () => {
    const paths = serverPaths();
    expect(paths).toEqual(expect.arrayContaining(['/spaces', '/dms', '/search', '/invites']));
    expect(paths.filter((p) => !apiPaths.includes(p))).toEqual([]);
  });

  it('matches whole path segments only', () => {
    expect(proxied('/me')).toBe(true);
    expect(proxied('/me/settings')).toBe(true);
    expect(proxied('/search?q=hi')).toBe(true);
    expect(proxied('/invites/abc')).toBe(true);
    // App routes stay with the dev server, which serves the SPA.
    expect(proxied('/')).toBe(false);
    expect(proxied('/invite/abc')).toBe(false);
    expect(proxied('/meet')).toBe(false);
    expect(proxied('/src/main.jsx')).toBe(false);
  });
});
