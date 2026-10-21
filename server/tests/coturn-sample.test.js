// P11-11 AC-6 (the part a test can check): the sample coturn config denies
// relaying to every private range, so TURN can't be used to reach a LAN, the
// cloud or Docker network, or a tailnet.
const fs = require('fs');
const net = require('net');
const path = require('path');

const conf = fs.readFileSync(path.join(__dirname, '..', '..', 'deploy', 'coturn', 'turnserver.conf.sample'), 'utf8');
const denied = conf.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('denied-peer-ip=')).map((l) => l.slice('denied-peer-ip='.length));

// IPv4 or IPv6 as a BigInt, for range checks.
function toBig(ip) {
  if (net.isIPv4(ip)) return ip.split('.').reduce((n, p) => (n << 8n) + BigInt(p), 0n);
  const [head, tail = ''] = ip.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const parts = ip.includes('::') ? [...h, ...Array(8 - h.length - t.length).fill('0'), ...t] : h;
  return parts.reduce((n, p) => (n << 16n) + BigInt(parseInt(p || '0', 16)), 0n);
}
const isV4 = (ip) => net.isIPv4(ip);
function isDenied(ip) {
  return denied.some((entry) => {
    const [lo, hi = lo] = entry.split('-');
    if (isV4(lo) !== isV4(ip)) return false;
    const n = toBig(ip);
    return n >= toBig(lo) && n <= toBig(hi);
  });
}

test.each([
  '0.0.0.1', '10.0.0.1', '10.255.255.254', '100.64.0.1', '100.100.100.100', '127.0.0.1', '169.254.169.254',
  '172.16.0.1', '172.31.255.254', '192.168.1.1', '192.168.255.254',
  '::1', 'fc00::1', 'fd7a:115c:a1e0::1', 'fe80::1',
])('%s is denied', (ip) => {
  expect(isDenied(ip)).toBe(true);
});

test.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '100.128.0.1', '2606:4700::1111'])('%s (public) is not', (ip) => {
  expect(isDenied(ip)).toBe(false);
});

test('it uses short-lived credentials and refuses multicast', () => {
  expect(conf).toMatch(/^use-auth-secret\b/m);
  expect(conf).toMatch(/^no-multicast-peers$/m);
});
