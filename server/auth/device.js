// A short, human label for a signed-in device (P9-03), from its User-Agent:
// "Chrome on Windows", "Safari on iPhone", "Firefox on Linux". Only the label
// is stored, never the User-Agent itself.

const BROWSERS = [
  [/Edg(e|A|iOS)?\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/SamsungBrowser\//, 'Samsung Internet'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];
const SYSTEMS = [
  [/iPhone/, 'iPhone'],
  [/iPad/, 'iPad'],
  [/Android/, 'Android'],
  [/CrOS/, 'ChromeOS'],
  [/Windows/, 'Windows'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/Linux/, 'Linux'],
];

function deviceLabel(userAgent) {
  const ua = typeof userAgent === 'string' ? userAgent : '';
  const browser = BROWSERS.find(([re]) => re.test(ua))?.[1];
  const system = SYSTEMS.find(([re]) => re.test(ua))?.[1];
  if (browser && system) return `${browser} on ${system}`;
  return browser || system || 'Unknown device';
}

// Whether it's a phone or tablet (for the list's icon).
function isMobileLabel(label) {
  return /iPhone|iPad|Android/.test(label || '');
}

module.exports = { deviceLabel, isMobileLabel };
