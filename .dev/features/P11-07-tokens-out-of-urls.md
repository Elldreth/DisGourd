# P11-07 — Session tokens out of URLs

- **Unit Type:** Implementation (child of P11-00)
- **Phase:** 11
- **State:** REVIEW (build order 10 in P11-00)
- **Starting baseline:** main at f844a59 (#224 merged)
- **Effort:** S–M
- **Depends on:** P11-03
- **Serialize with:** P11-03, then this, then P11-09
- **Requirement Source:** P11-00 finding M2.

## Problem
> **Priority after the tunnel (2026-10-21):** SWAG's access log is no longer in the path, and cloudflared doesn't log request URLs at its default level. Cloudflare terminates TLS, so it sees the token either way. What's left: the token in browser history and dev tools, and any log level or proxy added later. Build order 10.

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
- [x] AC-1: the socket URL in the app has no token (checked in a Vitest test of `useSocket` and in the sandbox's network panel).
- [x] AC-2: a socket that doesn't send `auth` within 5 seconds is closed; one that sends a bad token is closed with 4001.
- [x] AC-3: `GET /me?token=<valid>` without an Authorization header → 401.
- [x] AC-4: an upgrade with `Origin: https://evil.example` is refused.
- [x] AC-5: reconnect resync, voice rejoin and the signed-out flows still pass (`reconnect.test.js`, `sessions.test.js`, the web socket tests).

## As built
- **`server/gateway/index.js`:**
  - The upgrade checks the path, then the Origin, then either the old `?token=` or the new sign-in.
  - **First-frame sign-in:** without a token in the URL the socket opens unauthenticated. Nothing is sent and every frame but `{ op: 'auth', token }` is ignored. A good token admits the socket. A bad one, or no auth frame within `gatewayAuth.timeoutMs` (5 s), closes it with 4001 "Sign in again". More than `MAX_SOCKETS_PER_USER` closes the new socket with 1008 "Too many connections" (the old path still answers 429 before the upgrade).
  - **Pending cap:** at most `gatewayAuth.maxPendingPerIp` (20) sockets per client address (`clientIp`, so P11-05's trusted-proxy rules apply) may be waiting to sign in; more get 429. A socket stops counting once it signs in, closes or times out.
  - **The old `?token=` upgrade** still works for one release (tabs open across the update), with a deprecation warning at most once an hour (silent under test).
  - **Origin (L5):** an upgrade with an `Origin` header is refused (403) unless its host equals the `Host` or `X-Forwarded-Host` header, or the origin is listed in `ALLOWED_ORIGINS`. A page can't set either header on a WebSocket, so trusting `X-Forwarded-Host` here is safe. It also means a tunnel or proxy that rewrites `Host` doesn't lock everyone out. No `Origin` (not a browser) is allowed.
  - The connect frames and the handlers moved into `admit(ws, payload)`, unchanged.
- **`server/gateway/router.js`** needed no change: the `auth` frame is consumed before the router is attached.
- **`server/auth/tokens.js`:** `authPayload` reads only `Authorization: Bearer`. Nothing in `web/src` used `?token=` over HTTP (grep).
- **`web/src/useSocket.js`:** connects to `/gateway` and sends the auth frame first on every open, then the queued frames. Reconnect logic is unchanged.
- **Tests:** the 41 existing server test files still open `/gateway?token=`, so they exercise the deprecated path. The new `socket-auth.test.js` covers the new one. Switching them all to a shared auth-frame helper belongs with removing `?token=` (below).

## Verification Evidence
| Acceptance Criterion | Status | Verification Type | Evidence |
|---|---|---|---|
| AC-1 | Verified | Vitest `useSocket.test.js`; sandbox | Test: the URL is `ws://<host>/gateway` with no token on the first open and after a reconnect; `{ op: 'auth', token }` is the first frame sent, before a frame queued while connecting. Sandbox: the built bundle builds `…//${host}/gateway` (no `?token`), and a message sent through the app's socket arrived and rendered |
| AC-2 | Verified | Jest `socket-auth.test.js`; sandbox | Nothing is sent and a `focus` op is ignored before auth; after auth come `ready`, `unread`, `dm_unread`. A bad token gives 4001 "Sign in again". With the timeout at 200 ms, a silent socket gets 4001. Sandbox, from the browser: a socket to `/gateway` got no frames until the auth frame, then the same three |
| AC-3 | Verified | Jest; sandbox | `GET /me?token=<valid>` → 401; with `Authorization: Bearer` → 200. The same 401 from the sandbox browser |
| AC-4 | Verified | Jest | `Origin: https://evil.example` → 403. This host's origin, an `ALLOWED_ORIGINS` entry and no Origin all connect |
| AC-5 | Verified | Jest, Vitest | Server 66 suites / 571 tests (`reconnect.test.js`, `sessions.test.js`, `gateway-limits.test.js` included); web 108 files / 848 tests; `vite build` clean |
| Old clients | Verified | Sandbox | After the server restart, the tab still on the old bundle reconnected with `?token=` and worked; the server logged the deprecation warning once. Reload (the update toast) switched it to the new client |
| Pending cap | Verified | Jest | With the cap at 2, a third waiting socket gets 429, and signing one in frees a place |

## Discovered Work (not done here)
- **Remove the `?token=` upgrade** in a later release, once no old tabs are left. At the same time, switch the 41 test files to a shared helper that sends the auth frame.
- **Live check after deploying:** load the app through the tunnel and confirm the socket connects. If cloudflared ever stopped passing the public `Host` and `X-Forwarded-Host`, the Origin check would refuse the app's own socket (403). It accepts either header, so this is unlikely; `ALLOWED_ORIGINS=https://<your host>` is the fallback.

## Expected Areas of Change
`server/gateway/index.js`, `server/gateway/router.js` (the `auth` op is handled before routing), `server/auth/tokens.js`, `web/src/useSocket.js`, tests (server tests open sockets with `?token=`: switch them to a shared helper that sends the auth frame).

## Not in scope
HttpOnly cookie sessions (see P11-06's note).
