// P11-05: forwarding headers count only from a trusted proxy. Behind the
// Cloudflare Tunnel the proxy is cloudflared on its own Docker network, and
// CF-Connecting-IP (set by Cloudflare, not the visitor) names the client.
const { proxyTrust, clientIpVia, clientIp, fromTrustedProxy, parseCidrs } = require('../net/clientIp');

const req = (peer, headers = {}) => ({ headers, socket: { remoteAddress: peer } });
let saved;
beforeEach(() => {
  saved = { ...proxyTrust };
});
afterEach(() => Object.assign(proxyTrust, saved));
const trust = (cidrs, header = '') => Object.assign(proxyTrust, { enabled: true, cidrs: parseCidrs(cidrs), header });

test('off: the socket address, whatever the headers say', () => {
  Object.assign(proxyTrust, { enabled: false, cidrs: [], header: '' });
  expect(clientIp(req('203.0.113.9', { 'x-forwarded-for': '1.2.3.4', 'cf-connecting-ip': '5.6.7.8' }))).toBe('203.0.113.9');
  expect(clientIpVia(req('203.0.113.9')).via).toBe('socket');
});

test('TRUSTED_PROXIES + CLIENT_IP_HEADER: the header from the proxy, ignored from anyone else', () => {
  trust('172.30.80.0/24', 'cf-connecting-ip');
  expect(clientIpVia(req('172.30.80.5', { 'cf-connecting-ip': '198.51.100.7', 'x-forwarded-for': '9.9.9.9, 198.51.100.7' })))
    .toEqual({ ip: '198.51.100.7', peer: '172.30.80.5', via: 'cf-connecting-ip', trusted: true });
  // Another container on another network sends the same headers: its own address counts.
  expect(clientIpVia(req('172.18.0.9', { 'cf-connecting-ip': '198.51.100.7', 'x-forwarded-for': '198.51.100.7' })))
    .toEqual({ ip: '172.18.0.9', peer: '172.18.0.9', via: 'socket', trusted: false });
  // IPv4-mapped peers match IPv4 ranges.
  expect(clientIp(req('::ffff:172.30.80.5', { 'cf-connecting-ip': '2001:db8::7' }))).toBe('2001:db8::7');
  // A header that isn't an address falls back to X-Forwarded-For.
  expect(clientIpVia(req('172.30.80.5', { 'cf-connecting-ip': 'not-an-ip', 'x-forwarded-for': '198.51.100.8' }))).toMatchObject({ ip: '198.51.100.8', via: 'x-forwarded-for' });
});

test('without CLIENT_IP_HEADER: the right-most X-Forwarded-For hop that is not a trusted proxy', () => {
  trust('10.0.0.0/8');
  expect(clientIpVia(req('10.0.0.2', { 'x-forwarded-for': '1.2.3.4' }))).toMatchObject({ ip: '1.2.3.4', via: 'x-forwarded-for' });
  // Spoofed entries to the left are ignored; proxies on the right are skipped.
  expect(clientIp(req('10.0.0.2', { 'x-forwarded-for': '6.6.6.6, 1.2.3.4, 10.0.0.7' }))).toBe('1.2.3.4');
  // From an untrusted peer the header doesn't count at all.
  expect(clientIp(req('203.0.113.9', { 'x-forwarded-for': '1.2.3.4' }))).toBe('203.0.113.9');
  // Nothing forwarded: the proxy itself.
  expect(clientIp(req('10.0.0.2'))).toBe('10.0.0.2');
});

test('TRUST_PROXY=1 alone trusts loopback and private ranges (as before, for SWAG on a Docker network)', () => {
  Object.assign(proxyTrust, { enabled: true, cidrs: [], header: '' });
  expect(clientIp(req('172.18.0.5', { 'x-forwarded-for': '203.0.113.9' }))).toBe('203.0.113.9');
  expect(clientIp(req('::1', { 'x-forwarded-for': '203.0.113.10' }))).toBe('203.0.113.10');
  expect(clientIp(req('198.51.100.1', { 'x-forwarded-for': '203.0.113.11' }))).toBe('198.51.100.1'); // a public peer isn't a proxy
});

test('X-Forwarded-Host/-Proto count only from a trusted peer', () => {
  trust('10.0.0.0/8');
  expect(fromTrustedProxy(req('10.0.0.2'))).toBe(true);
  expect(fromTrustedProxy(req('203.0.113.9'))).toBe(false);
  Object.assign(proxyTrust, { enabled: false });
  expect(fromTrustedProxy(req('10.0.0.2'))).toBe(false);
});

test('parseCidrs: IPv4, IPv6, bare addresses; junk is refused loudly', () => {
  expect(parseCidrs('172.30.80.0/24, fd00::/8,127.0.0.1').length).toBe(3);
  expect(() => parseCidrs('172.30.80.0/40')).toThrow(/TRUSTED_PROXIES/);
  expect(() => parseCidrs('nonsense')).toThrow(/TRUSTED_PROXIES/);
});
