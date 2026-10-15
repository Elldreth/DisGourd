# P1-03 — Server split 2/4: route dispatcher + auth/me/admin/social routes

- **Unit Type:** Implementation
- **Phase:** 1 — "Split server.js"
- **State:** PLANNED (becomes READY when P1-02 is merged)
- **Effort:** M
- **Depends on:** P1-02
- **Serialize with:** P1-04, P1-05, P1-07, P1-16 (all edit `server.js`)
- **Requirement Source:** IMPROVEMENT-PLAN.md Phase 1

## Scope (pure move)
1. `server/routes/index.js`: an ordered list of route modules. Each one exports `async handle(ctx) → boolean` (true if it handled the request). `ctx = { req, res, parsedUrl, pathSegments }`. `handleHttp` keeps CORS/OPTIONS, tries the dispatcher, then falls through to the remaining inline branches (these are moved in P1-04).
2. `server/routes/auth.js`: `/auth-info`, `/register`, `/login`, `/me` (GET/PATCH).
3. `server/routes/admin.js`: `/admin/registration/**`.
4. `server/routes/social.js`: `/dms/**`, `/search`, `/friends/**`.

## Acceptance criteria
- [ ] `api.test.js` passes unmodified. That includes registration gating, 0.4 rate limits, 0.6 friends, DMs and search.
- [ ] Route order is preserved: an unmatched GET still falls back to the SPA, and other methods still get the JSON 404.
- [ ] `server.js` shrinks by roughly 250 more lines.

## Expected Areas of Change
`server/server.js`, plus new files `server/routes/{index,auth,admin,social}.js`.

## Working Set / Blast Radius
- Load: `server/server.js` lines 497-765 and 1085-1112, plus the P1-02 modules' exports.
- Blast radius: the auth endpoints. They are covered by the tests.
