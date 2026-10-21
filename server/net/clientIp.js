// Who is this request from (P11-05)? The socket's address, unless the socket
// is a proxy we trust: then the proxy's word for it.
//
//   TRUST_PROXY=1        trust forwarding headers from loopback and private
//                        addresses (SWAG or cloudflared on a Docker network)
//   TRUSTED_PROXIES=…    trust them only from these CIDRs (implies TRUST_PROXY),
//                        e.g. the Docker network only cloudflared shares
//   CLIENT_IP_HEADER=…   from a trusted proxy, take the client from this header
//                        (cf-connecting-ip: set by Cloudflare, never by the
//                        visitor); otherwise the right-most X-Forwarded-For
//                        hop that isn't itself a trusted proxy
//
// No dependencies (static.js uses it before the database exists). `proxyTrust`
// is the live setting; config.trustProxy reads and writes `enabled`.
const net = require('net');

function v4ToInt(ip) {
  return ip.split('.').reduce((n, part) => ((n << 8) >>> 0) + Number(part), 0) >>> 0;
}
function v6ToBigInt(ip) {
  let s = ip.toLowerCase().split('%')[0];
  const tail = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    const n = v4ToInt(tail[1]);
    s = `${s.slice(0, -tail[1].length)}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const [head, rest] = s.split('::');
  const a = head ? head.split(':') : [];
  const b = rest !== undefined && rest ? rest.split(':') : [];
  const words = [...a, ...Array(rest !== undefined ? 8 - a.length - b.length : 0).fill('0'), ...b];
  return words.reduce((n, w) => (n << 16n) + BigInt(parseInt(w || '0', 16)), 0n);
}

// '::ffff:1.2.3.4' -> '1.2.3.4'; anything else as is.
function plain(ip) {
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(String(ip || ''));
  return m ? m[1] : String(ip || '');
}

// "a.b.c.d/n, x::/n, a.b.c.d" -> [{ v, base, bits }]. Throws on junk, so a
// typo in TRUSTED_PROXIES stops the server instead of trusting nothing (or everything).
function parseCidrs(text) {
  return String(text || '').split(',').map((s) => s.trim()).filter(Boolean).map((entry) => {
    const [addr, bitsText] = entry.split('/');
    const v = net.isIP(addr);
    const max = v === 4 ? 32 : 128;
    const bits = bitsText === undefined ? max : Number(bitsText);
    if (!v || !Number.isInteger(bits) || bits < 0 || bits > max) {
      throw new Error(`TRUSTED_PROXIES: "${entry}" isn't an address or CIDR range (like 172.30.80.0/24)`);
    }
    return { v, base: v === 4 ? v4ToInt(addr) : v6ToBigInt(addr), bits };
  });
}

function inRange(ip, r) {
  const v = net.isIP(ip);
  if (v !== r.v) return false;
  if (v === 4) {
    const mask = r.bits === 0 ? 0 : (~0 << (32 - r.bits)) >>> 0;
    return ((v4ToInt(ip) & mask) >>> 0) === ((r.base & mask) >>> 0);
  }
  const shift = BigInt(128 - r.bits);
  return v6ToBigInt(ip) >> shift === r.base >> shift;
}

// What TRUST_PROXY=1 alone trusts: loopback and the private ranges.
const PRIVATE = parseCidrs('127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 100.64.0.0/10, ::1/128, fc00::/7');

const proxyTrust = {
  enabled: /^(1|true|yes|on)$/i.test(String(process.env.TRUST_PROXY || '')) || !!process.env.TRUSTED_PROXIES,
  cidrs: parseCidrs(process.env.TRUSTED_PROXIES),
  header: String(process.env.CLIENT_IP_HEADER || '').trim().toLowerCase(),
};

const isTrustedProxy = (ip) => {
  const p = plain(ip);
  return (proxyTrust.cidrs.length ? proxyTrust.cidrs : PRIVATE).some((r) => inRange(p, r));
};
const peerOf = (req) => plain((req && req.socket && req.socket.remoteAddress) || 'unknown');

// Whether this request came through a proxy we trust (for X-Forwarded-*).
function fromTrustedProxy(req) {
  return proxyTrust.enabled && isTrustedProxy(peerOf(req));
}

// { ip, peer, via: 'socket' | 'x-forwarded-for' | <header>, trusted }.
function clientIpVia(req) {
  const peer = peerOf(req);
  if (!proxyTrust.enabled || !isTrustedProxy(peer)) return { ip: peer, peer, via: 'socket', trusted: false };
  const headers = (req && req.headers) || {};
  if (proxyTrust.header) {
    const named = plain(String(headers[proxyTrust.header] || '').split(',')[0].trim());
    if (net.isIP(named)) return { ip: named, peer, via: proxyTrust.header, trusted: true };
  }
  const hops = String(headers['x-forwarded-for'] || '').split(',').map((s) => plain(s.trim())).filter(Boolean);
  for (let i = hops.length - 1; i >= 0; i -= 1) {
    if (!net.isIP(hops[i])) break; // junk: stop trusting the chain here
    if (!isTrustedProxy(hops[i])) return { ip: hops[i], peer, via: 'x-forwarded-for', trusted: true };
  }
  return { ip: peer, peer, via: 'socket', trusted: true };
}

const clientIp = (req) => clientIpVia(req).ip;

module.exports = { proxyTrust, clientIp, clientIpVia, fromTrustedProxy, parseCidrs, isTrustedProxy };
