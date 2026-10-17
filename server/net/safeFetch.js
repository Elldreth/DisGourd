// SSRF-safe HTTP(S) GET for link previews.
//
// Fetching a URL a user typed means the server makes a request on their behalf,
// so it must never reach anything private: loopback, the LAN, cloud metadata
// (169.254.169.254) and so on. The rules:
//   - http/https only, ports 80/443 only, no user:pass@ in the URL
//   - resolve the host once and refuse if ANY address is private/reserved
//   - connect to that already-checked address (the socket can't re-resolve,
//     so DNS rebinding can't swap in a private address), keeping Host/SNI
//   - every redirect hop goes through the same checks
//   - one deadline for the whole fetch, a byte cap, HTML bodies only
//   - no cookies or auth are ever sent
//
//   safeFetch(url, opts) -> { url, status, contentType, body } | null
//     null: a non-2xx status or a content type not in `types` (default: HTML).
//     opts.as: 'text' (default; decoded with the page's charset) or 'buffer'. Refusals and failures throw an
//     Error with `code`: BAD_URL, BLOCKED_PROTOCOL, BLOCKED_PORT, CREDENTIALS,
//     BLOCKED_ADDRESS, TOO_MANY_REDIRECTS, TOO_LARGE, TIMEOUT, NETWORK.

const http = require('http');
const https = require('https');
const dns = require('dns');
const net = require('net');

const USER_AGENT = 'DisGourdBot/1.0 (+link preview)';
const HTML_TYPES = new Set(['text/html', 'application/xhtml+xml']);
const ALLOWED_PORTS = new Set([80, 443]);

function fail(code, message) {
  return Object.assign(new Error(message), { code });
}

// ---- Address classification ----

function v4ToInt(ip) {
  const parts = ip.split('.').map(Number);
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

// [network, prefix length] pairs that must never be fetched.
const BLOCKED_V4 = [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, incl. cloud metadata
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.88.99.0', 24], // 6to4 relay anycast
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
].map(([base, bits]) => [v4ToInt(base), bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0]);

function blockedV4(ip) {
  const n = v4ToInt(ip);
  return BLOCKED_V4.some(([base, mask]) => ((n & mask) >>> 0) === base);
}

// The 8 16-bit words of an IPv6 address (handles "::" and a trailing dotted quad).
function v6Words(ip) {
  let s = ip.toLowerCase().split('%')[0];
  const tail = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    const n = v4ToInt(tail[1]);
    s = s.slice(0, -tail[1].length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const [head, rest] = s.split('::');
  const a = head ? head.split(':') : [];
  const b = rest !== undefined && rest ? rest.split(':') : [];
  const fill = rest !== undefined ? 8 - a.length - b.length : 0;
  return [...a, ...Array(fill).fill('0'), ...b].map((w) => parseInt(w, 16) || 0);
}

const wordsToV4 = (hi, lo) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

function blockedV6(ip) {
  const w = v6Words(ip);
  const zero = (from, to) => w.slice(from, to).every((x) => x === 0);
  if (zero(0, 8) || (zero(0, 7) && w[7] === 1)) return true; // :: and ::1
  if (zero(0, 5) && w[5] === 0xffff) return blockedV4(wordsToV4(w[6], w[7])); // ::ffff:a.b.c.d
  if (zero(0, 6)) return true; // ::a.b.c.d (deprecated IPv4-compatible)
  if (w[0] === 0x64 && w[1] === 0xff9b && zero(2, 6)) return blockedV4(wordsToV4(w[6], w[7])); // NAT64
  if (w[0] === 0x64 && w[1] === 0xff9b && w[2] === 1) return true; // local-use NAT64
  if (w[0] === 0x2002) return blockedV4(wordsToV4(w[1], w[2])); // 6to4 embeds an IPv4
  if (w[0] === 0x2001 && w[1] === 0) return true; // Teredo (embeds an obscured IPv4)
  if (w[0] === 0x2001 && w[1] === 0xdb8) return true; // documentation
  if (w[0] === 0x100 && zero(1, 4)) return true; // discard-only
  if ((w[0] & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
  if ((w[0] & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((w[0] & 0xffc0) === 0xfec0) return true; // old site-local
  if ((w[0] & 0xff00) === 0xff00) return true; // multicast
  return false;
}

function isBlockedAddress(ip) {
  const v = net.isIP(ip);
  if (v === 4) return blockedV4(ip);
  if (v === 6) return blockedV6(ip);
  return true; // not an address at all
}

function isLoopback(ip) {
  if (net.isIP(ip) === 4) return ip.startsWith('127.');
  return net.isIP(ip) === 6 && v6Words(ip).join(':') === '0:0:0:0:0:0:0:1';
}

// ---- Fetching ----

const defaultLookup = (host) => dns.promises.lookup(host, { all: true, verbatim: true });

// Check one URL and pick the address to connect to.
async function vet(rawUrl, { lookup, loopbackOk }) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    throw fail('BAD_URL', 'Not a valid URL');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw fail('BLOCKED_PROTOCOL', `${u.protocol} URLs are not fetched`);
  if (u.username || u.password) throw fail('CREDENTIALS', 'URLs with credentials are not fetched');
  const port = Number(u.port || (u.protocol === 'https:' ? 443 : 80));
  // Outside the test loopback, refuse odd ports before touching DNS.
  if (!loopbackOk && !ALLOWED_PORTS.has(port)) throw fail('BLOCKED_PORT', `Port ${port} is not fetched`);

  const host = u.hostname.replace(/^\[|\]$/g, '');
  let addresses;
  if (net.isIP(host)) addresses = [{ address: host, family: net.isIP(host) }];
  else {
    try {
      addresses = await lookup(host);
    } catch {
      throw fail('NETWORK', `Could not resolve ${host}`);
    }
  }
  if (!addresses || addresses.length === 0) throw fail('NETWORK', `Could not resolve ${host}`);

  const allowed = (a) => !isBlockedAddress(a.address) || (loopbackOk && isLoopback(a.address));
  if (!addresses.every(allowed)) throw fail('BLOCKED_ADDRESS', `${host} resolves to a private or reserved address`);
  if (!ALLOWED_PORTS.has(port) && !addresses.every((a) => isLoopback(a.address))) {
    throw fail('BLOCKED_PORT', `Port ${port} is not fetched`);
  }
  return { u, host, port, pick: addresses[0] };
}

function decode(buf, contentTypeHeader) {
  const m = /charset\s*=\s*"?([\w-]+)/i.exec(contentTypeHeader || '');
  try {
    return new TextDecoder(m ? m[1] : 'utf-8').decode(buf);
  } catch {
    return new TextDecoder('utf-8').decode(buf);
  }
}

// One request to an already-vetted target. Resolves with
// { redirect } | { response: null } | { response: {...} }.
function request({ u, host, port, pick }, { maxBytes, onRequest, types, as }) {
  return new Promise((resolve, reject) => {
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({
      protocol: u.protocol,
      hostname: host,
      port,
      path: `${u.pathname}${u.search}`,
      method: 'GET',
      agent: false, // no pooled sockets from earlier, differently-vetted requests
      servername: net.isIP(host) ? undefined : host,
      headers: { 'User-Agent': USER_AGENT, Accept: [...types].join(',') + ';q=0.9,*/*;q=0.1', 'Accept-Encoding': 'identity' },
      // Pin the connection to the address we checked.
      lookup: (_h, opts, cb) => {
        if (typeof opts === 'function') cb = opts;
        if (opts && opts.all) cb(null, [{ address: pick.address, family: pick.family }]);
        else cb(null, pick.address, pick.family);
      },
    });
    onRequest(req);
    // Our own aborts (TOO_LARGE, TIMEOUT) are flagged; anything else is a network failure.
    req.on('error', (err) => reject(err.safeFetch ? err : fail('NETWORK', err.message)));
    req.on('response', (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        req.destroy();
        return resolve({ redirect: new URL(res.headers.location, u).toString() });
      }
      const type = (res.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (status < 200 || status >= 300 || !types.has(type)) {
        req.destroy();
        return resolve({ response: null });
      }
      const declared = Number(res.headers['content-length']);
      if (declared > maxBytes) {
        req.destroy();
        return reject(fail('TOO_LARGE', 'The page is too large'));
      }
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > maxBytes) {
          const err = Object.assign(fail('TOO_LARGE', 'The page is too large'), { safeFetch: true });
          req.destroy(err);
          return;
        }
        chunks.push(c);
      });
      res.on('end', () =>
        resolve({
          response: {
            url: u.toString(),
            status,
            contentType: type,
            body: as === 'buffer' ? Buffer.concat(chunks) : decode(Buffer.concat(chunks), res.headers['content-type']),
          },
        })
      );
      res.on('error', (err) => reject(err.safeFetch ? err : fail('NETWORK', err.message)));
    });
    req.end();
  });
}

async function safeFetch(
  url,
  { timeoutMs = 5000, maxBytes = 512 * 1024, maxRedirects = 3, lookup = defaultLookup, allowLoopback = false, types = HTML_TYPES, as = 'text' } = {}
) {
  const allowedTypes = types instanceof Set ? types : new Set(types);
  // Test-only: lets the suite talk to a local server. Ignored everywhere else.
  const loopbackOk = !!allowLoopback && process.env.NODE_ENV === 'test';
  let current = null; // the in-flight request, if any
  let timer;
  // One deadline for everything: DNS, every hop, and reading the body.
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      current?.destroy();
      reject(fail('TIMEOUT', 'The page took too long'));
    }, timeoutMs);
  });
  const run = async () => {
    let next = url;
    for (let hop = 0; ; hop += 1) {
      if (hop > maxRedirects) throw fail('TOO_MANY_REDIRECTS', 'Too many redirects');
      const target = await vet(next, { lookup, loopbackOk });
      const out = await request(target, { maxBytes, types: allowedTypes, as, onRequest: (req) => (current = req) });
      if (!out.redirect) return out.response;
      next = out.redirect;
    }
  };
  const work = run();
  work.catch(() => {}); // if the deadline wins, a later failure here is expected
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
    current?.destroy();
  }
}

module.exports = { safeFetch, isBlockedAddress, USER_AGENT };
