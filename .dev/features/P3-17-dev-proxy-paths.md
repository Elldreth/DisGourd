# P3-17 — Dev server forwards every API path (`/me`, `/dms`, `/search`, `/invites`)

- **Unit Type:** Implementation (dev-tooling fix)
- **Phase:** 3
- **State:** COMPLETE (merged #123)
- **Effort:** S
- **Depends on:** none
- **Serialize with:** `web/vite.config.js`

## Problem
The Vite dev server proxies a fixed list of API paths to the backend. Since milestone 1 the list has missed `/me`, `/dms`, `/search` and `/invites`, which the client calls. Through the dev server those requests got the app's `index.html` instead of JSON, so on `npm run dev` (and the sandbox web server on :5174) the profile never loaded: site-admin settings sections were missing, and DMs, search and invite links failed. Found while live-testing the /imagine settings (P2-20b). Production was never affected: there the Node server serves the API and the built app from one origin.

## Scope
1. Move the list to `web/devProxy.js` and add the four missing paths.
2. Make each proxy entry match a whole path segment (`/me` and `/me/…`, not `/media`-style prefixes or the app's own `/invite/<code>` route). Vite treats a key starting with `^` as a regular expression.
3. A web test that fails when the client calls, or a server route answers, a top-level path the proxy doesn't forward.

## Acceptance criteria
- [x] Every top-level path in `request(…)`, `fetch(…)` and `xhr.open(…)` calls under `web/src` is proxied.
- [x] Every top-level path the server's route modules dispatch on is proxied.
- [x] `/invite/<code>`, `/` and other app routes still get the SPA.
- [x] Web suite and `vite build` pass.

## Expected Areas of Change
`web/vite.config.js`, `web/devProxy.js` (new), `web/src/devProxy.test.js` (new).

## Working Set / Blast Radius
3 files, dev server only.

## Evidence (2026-10-18)
| Acceptance criterion | Evidence |
|---|---|
| Client paths proxied | `devProxy.test.js` "forwards every top-level path the client calls" scans `web/src` (tests excluded). Removing `/me` and `/uploads` from the list makes it fail and name both |
| Server paths proxied | `devProxy.test.js` "forwards every top-level path the server routes answer" scans `server/routes/*.js` (`pathSegments[0] === …`, `path === '/…'`, `startsWith('/…')`) |
| App routes stay with the SPA | `devProxy.test.js` "matches whole path segments only". Live: Vite on :5199 pointed at a stub backend on :3999 sent `/me`, `/dms`, `/search?q=x`, `/invites/abc`, `/spaces` to the backend and served `index.html` for `/invite/abc`, `/meet`, `/` |
| Suites pass | Web: 65 files, 566 tests. `vite build` clean |

## Discovered Work
None.
