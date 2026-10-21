// Confirmation links (P12-02): <origin>/#confirm-email=<token>. The token is
// in the fragment, so it isn't sent to the server in the request line or kept
// in proxy logs; the app reads it once, takes it out of the address bar, and
// posts it. Returns the token, or ''.
const PREFIX = '#confirm-email=';

export function captureConfirmToken(loc = window.location) {
  if (!loc.hash.startsWith(PREFIX)) return '';
  const token = loc.hash.slice(PREFIX.length).trim();
  try {
    window.history.replaceState(null, '', loc.pathname + loc.search);
  } catch {
    /* the token is still used; it just stays in the address bar */
  }
  return /^[A-Za-z0-9_-]{20,100}$/.test(token) ? token : '';
}
