// Invite deep links: <origin>/invite/<code> (or ?invite=<code>) opens the app
// with that invite waiting. The code is remembered in sessionStorage so it
// survives the sign-in / registration screen; once signed in, ServerRail opens
// the Join dialog with it and the app calls clearPendingInvite().

const KEY = 'disgourd.pendingInvite';

export function inviteLink(code, origin = window.location.origin) {
  return `${origin}/invite/${encodeURIComponent(code)}`;
}

// The invite code in a URL (a Location or URL), or ''.
export function readInviteFromLocation(loc = window.location) {
  const fromQuery = new URLSearchParams(loc.search).get('invite');
  if (fromQuery && fromQuery.trim()) return fromQuery.trim();
  const m = /^\/invite\/([^/]+)\/?$/.exec(loc.pathname);
  if (!m) return '';
  try {
    return decodeURIComponent(m[1]).trim();
  } catch {
    return '';
  }
}

// The invite waiting to be opened: from the URL (remembered for later), or
// one remembered earlier in this tab.
export function capturePendingInvite() {
  const code = readInviteFromLocation();
  try {
    if (code) sessionStorage.setItem(KEY, code);
    return code || sessionStorage.getItem(KEY) || '';
  } catch {
    return code; // storage blocked: it still works if you're already signed in
  }
}

// The invite has been shown: forget it and take it out of the address bar.
export function clearPendingInvite() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* nothing remembered */
  }
  const url = new URL(window.location.href);
  if (!readInviteFromLocation(url)) return;
  url.searchParams.delete('invite');
  if (/^\/invite\//.test(url.pathname)) url.pathname = '/';
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
}
