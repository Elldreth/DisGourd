# P11-03 — Gateway abuse limits

- **Unit Type:** Implementation (child of P11-00)
- **Phase:** 11
- **State:** COMPLETE (merged in #217)
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
- [x] AC-1: a `read` frame for a server or channel the user can't see writes nothing (the proof script's H2 check shows 0 new rows).
- [x] AC-2: sending 50 messages in a second stores at most 10, and the sender gets `RATE_LIMITED`.
- [x] AC-3: an 11th socket for the same user is refused; the first 10 keep working.
- [x] AC-4: the 11th search in a minute answers 429.
- [x] AC-5: normal use is untouched: the full server and web suites pass, and nothing in them needs raising (if a test floods on purpose, it sets the limits through a test hook rather than the suite turning them off).
- [x] AC-6: limits are skipped where `config.rateLimit` is false today (NODE_ENV=test), except in the new tests that switch them on.

## As built
- **`server/gateway/limits.js`** (new) holds token buckets per person, shared by all their sockets, with the numbers in one `LIMITS` table:
  - All frames: 30/s, burst 60.
  - `message`, `dm`: 10 per 10 s.
  - `react`: 20 per 10 s.
  - `typing`, `dm_typing`: 1/s, dropped silently.
  - `dm_group_create`, `dm_group_add`: 5 a minute.
  - Old buckets are swept every minute.
  - Everything follows `config.rateLimit`: off under `NODE_ENV=test`, so the other suites are untouched, and the new suite turns it on.
- **`router.js`:**
  - Every frame is checked before dispatch.
  - A refused one is dropped. For non-silent ops, the sender gets `{ type: 'error', op, code: 'RATE_LIMITED', retryAfter, space?, channel?, error }`, at most once a second per op.
  - A socket sending more than 1,500 frames in 5 s (10× the rate) is closed with 1008 and terminated a second later.
- **`chat.js`:**
  - `read` stores a marker only for a channel (or thread) that exists and that the person can see, with `lastId` clamped to 0…`MAX_SAFE_INTEGER`.
  - `focus` ignores names over 100 characters.
- **`gateway/index.js`:** a person's 11th socket gets `HTTP 429` at the upgrade.
- **`routes/social.js`:** `GET /search` is limited to 10 a minute per person (429 "Too many searches. Please wait a minute.").
- **Web:** `rateLimit.js` (`rateLimitNotice`) turns a `RATE_LIMITED` frame into a toast ("You’re sending messages too fast: that one wasn’t sent. Try again in N s."), shown from App's gateway `error` handler. The message isn't optimistic, so nothing needs rolling back.

## Verification Evidence
| Acceptance Criterion | Status | Verification Type | Evidence |
|---|---|---|---|
| AC-1 | Verified | Jest `gateway-limits.test.js` + sandbox | A 100 KB name, a made-up channel, a server you're not in, and a huge `lastId` → only the real `general` row, with a safe `lastId`. Sandbox as bob: 50 KB names, a made-up channel and a server he isn't in left his `read_state` count at 12 → 12 |
| AC-2 | Verified | Jest + sandbox + app | 50 messages → ≤10 stored, `RATE_LIMITED` with space, channel and `retryAfter`, at most 5 such frames. Sandbox: 30 sent → 10 stored, 1 `RATE_LIMITED` frame. In the app, sandy sending 11 quickly: 10 posted, and the toast read "You’re sending messages too fast: that one wasn’t sent. Try again in 1 s." All the test messages were deleted afterwards |
| AC-3 | Verified | Jest + sandbox | The 11th socket → 429, and a message from socket 1 still reaches socket 10. Sandbox: the 11th → `refused 429` |
| AC-4 | Verified | Jest + sandbox | 10 × 200, then 429 with the message (both) |
| AC-5 | Verified | Jest, Vitest | Server 57 suites / 512 tests; web 107 files / 844 tests. No existing test needed a change |
| AC-6 | Verified | Code + suites | `limits.allow`, `flooded` and `tooManySockets` return early when `config.rateLimit` is false; only `gateway-limits.test.js` sets it true |
| Flood close | Verified | Jest | 1,700 `focus` frames → the socket closes with 1008 |
| Typing | Verified | Jest | 20 typing frames → no error frames (dropped quietly) |

## Discovered Work (not done here)
- **Buckets live in memory:** a restart resets them, which is fine for one process.
- **A Jest exit notice:** when `gateway-limits.test.js` runs alone, Jest says it "did not exit one second after the run" (the flooded socket's close). The process still ends about 2 s later (4 s in total), and the full suite isn't affected.

## Expected Areas of Change
`server/gateway/router.js` (the bucket), `server/gateway/chat.js` (`read`, `focus`), `server/gateway/index.js` (socket cap), `server/routes/social.js` (search), `server/auth/rateLimit.js` (it may gain a bucket helper; keep it bounded, see P11-08), `web/src/useSocket.js` or the composer for the notice, tests (`server/tests/gateway-limits.test.js` new; web composer notice).

## Not in scope
Upload quotas (P11-04). IP-level connection caps (the proxy, P11-05).
