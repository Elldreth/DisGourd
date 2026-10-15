# P1-02 — Server split 1/4: core modules (config, auth, http utils, permissions, delivery)

- **Unit Type:** Implementation (child of the "Split server.js" effort: P1-02 → P1-03 → P1-04 → P1-05)
- **Phase:** 1 — IMPROVEMENT-PLAN.md "Split server.js"
- **State:** READY
- **Effort:** M
- **Depends on:** none
- **Serialize with:** every unit editing `server/server.js` (P1-03..05, P1-07, P1-16)
- **Requirement Source:** design/IMPROVEMENT-PLAN.md Phase 1; `server/server.js` is 1,575 lines (revalidated 2026-10-15)

## Why split into 4 units
`server.js` is ~20k tokens. Moving it all at once means one giant diff, which is hard to review and hard to bisect. Each slice is a pure move with the existing 30+ integration tests as the safety net. The slices go in order because they all edit the same file.

## Scope (pure move — no behaviour change)
Extract from `server.js` lines 1-375 and 1143-1183:
| New module | Contents |
|---|---|
| `server/config.js` | config.json/env loading, registration-mode seeding, `isWeakSecret`, `resolveJwtSecret`, `SECRET_FILE`, `registrationMode()` |
| `server/auth/passwords.js` | scrypt helpers, legacy HMAC, `verifyPassword`, `generateSalt` |
| `server/auth/tokens.js` | `createToken`, `verifyToken`, `authUserId` |
| `server/auth/rateLimit.js` | `rateLimitOk`, `clientIp`, `safeEqual` |
| `server/http/util.js` | `sendJson`, `httpError`, `intParam`, `isPlainObject`, `readJsonBody`, `sanitizeCrop`, `safeDecode`, size-limit constants |
| `server/validate.js` | name/registration validators, `normalizeChannelName`, `parseMentionUsernames`, `normalizeAttachments`, `MAX_MESSAGE_LENGTH`, `MAX_ATTACHMENTS` |
| `server/permissions.js` | `canViewChannel`, `canPostChannel`, `canView(space, channel, userId)` (canModerate is added later, in P1-10) |
| `server/gateway/delivery.js` | `userClients`, `sendToUser`, `deliverToSpaceMembers`, `deliverToChannelViewers`, `broadcastPresence` |

`server.js` keeps `handleHttp`, the gateway handlers, voice, and boot. It must still export `{ httpServer, wss, config, db, isWeakSecret, resolveJwtSecret, clientIp }` (tests import these).

## Acceptance criteria
- [ ] `npm test` passes with `server/tests/api.test.js` **unmodified**.
- [ ] `server.js` shrinks by ≥ 400 lines. No new module is over ~250 lines.
- [ ] No circular requires: `config` → (db), `auth/*` → config, `permissions` → db, `delivery` → db, ws.
- [ ] `node server/server.js` boots and prints the same banner. Login and sending a message work (manual smoke).
- [ ] `git diff --stat` shows moves only. No logic edits apart from require/export wiring.

## Expected Areas of Change
- `server/server.js` (remove ~450 lines, add requires)
- 8 new files listed above

## Working Set / Blast Radius
- Load: `server/server.js` in full (needed to find all call sites), `server/tests/api.test.js` lines 1-30.
- Blast radius: the whole server, but behaviour-neutral. The test suite covers auth, rate limit, permissions and delivery (tests 0.1–0.7).
- Hidden coupling: `config.jwtSecret` is resolved at require time. Tests set env *before* `require('../server')`, so `config.js` must not be required earlier by anything the tests load first (`db` is fine).
