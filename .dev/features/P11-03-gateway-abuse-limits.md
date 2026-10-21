# P11-03 — Gateway abuse limits

- **Unit Type:** Implementation (child of P11-00)
- **Phase:** 11
- **State:** READY (build order 4 in P11-00; start only when the owner says so)
- **Effort:** M
- **Depends on:** none
- **Serialize with:** P11-07 and P11-09 (`server/gateway/index.js`, `router.js`, `dm.js`). This goes first.
- **Requirement Source:** P11-00 finding H2 (the gateway and search half; uploads are P11-04).

## Problem
Any signed-in member can:
- Write unlimited `read_state` rows with arbitrary strings up to 256 KB each, through the `read` op (`server/gateway/chat.js:72-76`, `server/db/index.js:1275`). 20 frames made 4.7 MB.
- Send any op as fast as the socket allows. There's no per-user limit on `message`, `dm`, `react`, `typing`, `voice_signal` and the rest (`server/gateway/router.js:18-51`), and each message fans out to every viewer, pushes and link previews.
- Open any number of sockets (`server/gateway/index.js:99-100`).
- Run `GET /search` (an unindexed `LIKE '%q%'`) in a tight loop (`server/routes/social.js:83-90`).

## Scope
- **`read`:** only for a channel the user can view (`canView`). `dm_read` already checks that you're in the conversation. Otherwise drop the frame. `lastId` is clamped to a sane integer.
- **`focus`:** keep `space` / `channel` only if they're under 100 characters (they're compared, never stored).
- **A token bucket per socket user in `router.js`** before dispatch, with limits in one table so they're easy to tune:
  - All frames: 30 per second, with a burst of 60.
  - `message`, `dm`: 10 per 10 seconds (moderators aren't exempt; slow mode stays separate).
  - `react`: 20 per 10 seconds.
  - `typing`, `dm_typing`: 1 per second (extra frames are silently dropped).
  - `dm_group_create`, `dm_group_add`: 5 per minute.
  - `imagine` already has daily limits.
  - Going over sends `{ type: 'error', op, code: 'RATE_LIMITED', retryAfter }` (the app shows it like slow mode). Going far over (10× the overall rate for 5 seconds) closes the socket with 1008.
- **Sockets:** at most 10 per user. The 11th upgrade is refused (the oldest stays).
- **Search:** at most 10 per minute per user (`rateLimitOk('search:'+id, …)`), answering 429.
- **The client:** a `RATE_LIMITED` frame shows a short notice in the composer ("You're sending messages too fast"). It reuses the slow-mode notice if one fits.

## Acceptance criteria
- [ ] AC-1: a `read` frame for a server or channel the user can't see writes nothing (the proof script's H2 check shows 0 new rows).
- [ ] AC-2: sending 50 messages in a second stores at most 10, and the sender gets `RATE_LIMITED`.
- [ ] AC-3: an 11th socket for the same user is refused; the first 10 keep working.
- [ ] AC-4: the 11th search in a minute answers 429.
- [ ] AC-5: normal use is untouched: the full server and web suites pass, and nothing in them needs raising (if a test floods on purpose, it sets the limits through a test hook rather than the suite turning them off).
- [ ] AC-6: limits are skipped where `config.rateLimit` is false today (NODE_ENV=test), except in the new tests that switch them on.

## Expected Areas of Change
`server/gateway/router.js` (the bucket), `server/gateway/chat.js` (`read`, `focus`), `server/gateway/index.js` (socket cap), `server/routes/social.js` (search), `server/auth/rateLimit.js` (it may gain a bucket helper; keep it bounded, see P11-08), `web/src/useSocket.js` or the composer for the notice, tests (`server/tests/gateway-limits.test.js` new; web composer notice).

## Not in scope
Upload quotas (P11-04). IP-level connection caps (the proxy, P11-05).
