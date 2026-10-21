const url = require('url');
const { safeDecode } = require('./util');
const { dispatch } = require('../routes');
const { serveWebApp } = require('../static');

// ALLOWED_ORIGINS: comma-separated origins (scheme://host[:port]) that may call
// the API from another site. Read per request, so it can change without code.
const allowedOrigins = () => String(process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);

// HTTP request handler. Any throw or rejection inside is caught by the wrapper
// below and turned into an error response instead of crashing the process.
async function handleHttp(req, res) {
  const parsedUrl = url.parse(req.url, true);
  const pathSegments = parsedUrl.pathname.split('/').filter(Boolean).map(safeDecode); // decoded, e.g. ['spaces', 'My Server', 'channels']

  res.setHeader('Content-Type', 'application/json');
  // P11-06: on every answer. (Behind Cloudflare its "nosniff" setting may add
  // the same header; one value or two identical ones mean the same.)
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  // P11-06: the app is same-origin, so no CORS unless an origin is listed in
  // ALLOWED_ORIGINS (e.g. a separately hosted client).
  const origin = req.headers.origin;
  if (origin && allowedOrigins().includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  if (await dispatch({ req, res, parsedUrl, pathSegments })) return;

  // Anything else: unmatched GETs serve the web client (with SPA fallback);
  // other methods get a JSON 404.
  if (req.method === 'GET') {
    return serveWebApp(parsedUrl.pathname, res, req);
  }
  if (!res.writableEnded) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  }
}

function handleHttpError(res, err) {
  const status = err && Number.isInteger(err.status) ? err.status : 500;
  if (status >= 500) console.error('[http] Unhandled error:', err);
  if (res.headersSent) {
    res.destroy();
    return;
  }
  const headers = { 'Content-Type': 'application/json' };
  if (status === 413) headers.Connection = 'close'; // don't keep reading an oversized body
  res.writeHead(status, headers);
  res.end(JSON.stringify({ error: status >= 500 ? 'Internal server error' : err.message }));
}

module.exports = { handleHttp, handleHttpError };
