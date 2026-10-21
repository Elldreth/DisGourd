# P11-07 — Session tokens out of URLs

- **Unit Type:** Implementation (child of P11-00)
- **Phase:** 11
- **State:** PLANNED (after P11-03; both change `server/gateway/index.js`)
- **Effort:** S–M
- **Depends on:** P11-03
- **Serialize with:** P11-03, then this, then P11-09
- **Requirement Source:** P11-00 finding M2.

## Problem
- The app opens `/gateway?token=…` (`web/src/useSocket.js:37`; `server/gateway/index.js:83`).
- Every HTTP route also accepts `?token=` (`server/auth/tokens.js:60`).
- Proxies, load balancers and log shippers record the request line, so a 7-day bearer token ends up in log files the owner doesn't fully control.

## Scope
- **Server:**
  - The upgrade no longer needs a token in the URL. The socket starts unauthenticated, and its first frame must be `{ op: 'auth', token }` within 5 seconds, or it's closed (4001, "Sign in again"). Until then nothing is sent and every other op is ignored.
  - After auth, the ready, unread and voice frames go out exactly as today (move that block into a function).
  - Keep reading `?token=` on the upgrade for one release, for open tabs on the old client, logged as deprecated. A follow-up removes it.
  - Accept unauthenticated upgrades only up to a small per-IP cap (the proxy also limits).
- **Client:** `useSocket.js` connects to `/gateway` and sends the auth frame on `open`. Reconnect logic is unchanged.
- **HTTP:** `authPayload` stops reading `parsedUrl.query.token`. `grep` first: nothing in `web/src` uses it today, only the socket.
- **Origin check (L5):** while here, the upgrade refuses an `Origin` that isn't this host or one in `ALLOWED_ORIGINS` (requests without Origin, from non-browsers, are still allowed).

## Acceptance criteria
- [ ] AC-1: the socket URL in the app has no token (checked in a Vitest test of `useSocket` and in the sandbox's network panel).
- [ ] AC-2: a socket that doesn't send `auth` within 5 seconds is closed; one that sends a bad token is closed with 4001.
- [ ] AC-3: `GET /me?token=<valid>` without an Authorization header → 401.
- [ ] AC-4: an upgrade with `Origin: https://evil.example` is refused.
- [ ] AC-5: reconnect resync, voice rejoin and the signed-out flows still pass (`reconnect.test.js`, `sessions.test.js`, the web socket tests).

## Expected Areas of Change
`server/gateway/index.js`, `server/gateway/router.js` (the `auth` op is handled before routing), `server/auth/tokens.js`, `web/src/useSocket.js`, tests (server tests open sockets with `?token=`: switch them to a shared helper that sends the auth frame).

## Not in scope
HttpOnly cookie sessions (see P11-06's note).
