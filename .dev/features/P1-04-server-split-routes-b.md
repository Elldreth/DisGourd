# P1-04 — Server split 3/4: spaces, invites, uploads, static routes

- **Unit Type:** Implementation
- **Phase:** 1 — "Split server.js"
- **State:** PLANNED (READY when P1-03 merged)
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
- [ ] `api.test.js` passes unmodified. That includes the upload size/type tests and the 0.3 private-channel tests.
- [ ] `server.js` contains no route logic.
- [ ] The built web client is still served at `/` with SPA fallback, and `/assets/*` still sends the immutable cache header (manual check after `npm run build`).

## Expected Areas of Change
`server/server.js`, plus new files `server/routes/{spaces,invites,uploads}.js`, `server/static.js` and `server/http/handler.js`.

## Working Set / Blast Radius
- Load: `server/server.js` lines 764-1112 (after P1-03 these are the remaining HTTP lines).
- Blast radius: membership and permission enforcement on REST. It is covered by the tests in P1-02's list.
