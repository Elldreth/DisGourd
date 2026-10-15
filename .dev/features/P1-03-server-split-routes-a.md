# P1-03 — Server split 2/4: route dispatcher + auth/me/admin/social routes

- **Unit Type:** Implementation
- **Phase:** 1 — "Split server.js"
- **State:** REVIEW (PR open)
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
- [x] `api.test.js` passes unmodified. That includes registration gating, 0.4 rate limits, 0.6 friends, DMs and search.
- [x] Route order is preserved: an unmatched GET still falls back to the SPA, and other methods still get the JSON 404.
- [x] `server.js` shrinks by roughly 250 more lines.

## Expected Areas of Change
`server/server.js`, plus new files `server/routes/{index,auth,admin,social}.js`.

## Working Set / Blast Radius
- Load: `server/server.js` lines 497-765 and 1085-1112, plus the P1-02 modules' exports.
- Blast radius: the auth endpoints. They are covered by the tests.

## Activation
- Activated 2026-10-15 on branch `claude/p1-03-server-split-routes-a`, cut from main @ 7919269 (after P1-02 and P1-11 merged).
- Baseline: 29/29 server tests passing (2 suites).

## Implementation note
Each moved `if`/`else if` branch became a `{ match, run }` entry. Its condition and body are copied verbatim (re-indented). `handle(ctx)` runs the first matching entry and resolves true. Every moved branch already ended in a response on all paths, so "matched → handled" is exactly the old chain's behaviour. `server.js` calls `dispatch()` right after the OPTIONS check, where those branches used to sit, and the next `else if (spaces)` becomes a plain `if`.

## Verification (AC → evidence)
| AC | Evidence |
|---|---|
| Tests pass unmodified | 29/29 (both suites). Test files are not in the diff. |
| Route order / fallbacks | Sandbox: `GET /some/unknown/page` → 200 text/html (SPA). `POST /some/unknown` → 404 `{"error":"Not Found"}`. `/auth-info`, `/login` (good and bad password), `/me`, `/dms`, `/friends`, `/admin/registration` and `/spaces` all answer as before. |
| `server.js` −250 lines | 1,167 → 918 (−249). ESLint `no-undef` / `no-unused-vars`: clean after trimming the imports the moved code no longer needs from `server.js`. |
