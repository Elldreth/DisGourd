# P1-04 — Server split 3/4: spaces, invites, uploads, static routes

- **Unit Type:** Implementation
- **Phase:** 1 — "Split server.js"
- **State:** REVIEW (PR open)
- **Effort:** M
- **Depends on:** P1-03
- **Serialize with:** P1-05, P1-07, P1-16
- **Requirement Source:** IMPROVEMENT-PLAN.md Phase 1

## Scope (pure move)
- `server/routes/spaces.js`: all of `/spaces/**`. This covers create, patch (icon and rename), delete, members, roles, kick, invites creation, permissions, channel messages, channel permissions, and channel create/delete. Spaces is the largest route group (~170 lines). If it goes over ~300 lines, split channel routes into `routes/channels.js`.
- `server/routes/invites.js`: `/invites/:code` preview and join.
- `server/routes/uploads.js`: POST `/uploads` (streaming), GET `/uploads/**`, `BLOCKED_EXTENSIONS`, `CONTENT_TYPES`, `INLINE_EXTENSIONS`, `sanitizeFilename`, `UPLOADS_DIR`.
- `server/static.js`: `serveWebApp`, `STATIC_TYPES`, `WEB_DIST`.
- Move `handleHttp` and `handleHttpError` into `server/http/handler.js`. `server.js` then only does `http.createServer(...)`.

## Acceptance criteria
- [x] `api.test.js` passes unmodified. That includes the upload size/type tests and the 0.3 private-channel tests.
- [x] `server.js` contains no route logic.
- [x] The built web client is still served at `/` with SPA fallback, and `/assets/*` still sends the immutable cache header (manual check after `npm run build`).

## Expected Areas of Change
`server/server.js`, plus new files `server/routes/{spaces,invites,uploads}.js`, `server/static.js` and `server/http/handler.js`.

## Working Set / Blast Radius
- Load: `server/server.js` lines 764-1112 (after P1-03 these are the remaining HTTP lines).
- Blast radius: membership and permission enforcement on REST. It is covered by the tests in P1-02's list.

## Activation
- Activated 2026-10-15 on branch `claude/p1-04-server-split-routes-b`, cut from main @ e03b068 (after P1-03 merged).
- Baseline: 29/29 server tests passing (2 suites); `server.js` 918 lines.

## Implementation notes
- `routes/spaces.js` (202 lines) stays one module. It is under the ~300-line threshold for splitting out `routes/channels.js`.
- The upload constants and helpers moved with the upload routes. **Only non-verbatim change:** the default `UPLOADS_DIR` path gains one `'..'` (`path.join(__dirname, '..', '..', 'uploads')`) because the module sits one directory deeper. It resolves to the same `<repo>/uploads` (checked with `path.join`).
- `handleHttp` lost its now-unused `getJsonBody` alias. Everything else in it is unchanged.
- The route modules are tried in the old chain's order: auth, admin, social, spaces, invites, uploads. None of the conditions overlap, and every matched branch sends a response.

## Verification (AC → evidence)
| AC | Evidence |
|---|---|
| Tests pass unmodified | 29/29 (both suites). Test files are not in the diff. ESLint `no-undef` / `no-unused-vars`: clean. |
| `server.js` has no route logic | 918 → 443 lines. What remains: requires, `createServer(handleHttp)`, the WebSocket upgrade, heartbeat, voice and gateway (P1-05). |
| Web client + SPA + asset caching | Sandbox: `/` and `/channels/x` → 200 HTML. `/assets/*.js` → `Cache-Control: public, max-age=31536000, immutable`. `/favicon.svg` → `image/svg+xml`. |
| (extra) uploads / spaces / invites | Upload → 201. Fetching it gives `nosniff` and `attachment` disposition. `.exe` → 415. `/uploads/../server/config.js` → 404. Members, invite create + preview and channel messages all respond as before. |
