const path = require('path');
const fs = require('fs');

// ---- Serving the built web client ----
// In production the Node server hosts the compiled React app so the whole thing
// runs on a single port. In development the Vite dev server handles this and
// proxies API calls back here instead.
const WEB_DIST = process.env.WEB_DIST
  ? path.resolve(process.env.WEB_DIST)
  : path.join(__dirname, '..', 'web', 'dist');

const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ogg': 'audio/ogg', // UI sounds (P5-06)
  '.map': 'application/json; charset=utf-8',
};

function serveWebApp(pathname, res) {
  const rel = !pathname || pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const safe = path.normalize(rel).replace(/^(\.\.[\/\\])+/, '');
  let filePath = path.join(WEB_DIST, safe);
  if (filePath !== WEB_DIST && !filePath.startsWith(WEB_DIST + path.sep)) {
    filePath = path.join(WEB_DIST, 'index.html');
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      // Unknown path (or the app hasn't been built): fall back to index.html so
      // client-side routes still resolve. If there's no build at all, show a hint.
      fs.readFile(path.join(WEB_DIST, 'index.html'), (err2, html) => {
        if (err2) {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          return res.end(
            'DisGourd API is running. Build the web client with `npm run build` to serve the UI here.'
          );
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
        res.end(html);
      });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const headers = { 'Content-Type': STATIC_TYPES[ext] || 'application/octet-stream' };
    // Vite fingerprints filenames under /assets, so they're safe to cache hard.
    // The shell, the service worker and the manifest must be re-checked on
    // every load, or a new deploy would go unnoticed (P2-18a).
    if (filePath.includes(`${path.sep}assets${path.sep}`)) {
      headers['Cache-Control'] = 'public, max-age=31536000, immutable';
    } else if (['index.html', 'sw.js', 'manifest.json'].includes(safe)) {
      headers['Cache-Control'] = 'no-cache';
    }
    res.writeHead(200, headers);
    res.end(content);
  });
}

module.exports = { serveWebApp, WEB_DIST };
