# P1-05 — Server split 4/4: gateway (router, chat, dm, voice)

- **Unit Type:** Implementation
- **Phase:** 1 — "Split server.js" (`gateway/{router,voice}`)
- **State:** REVIEW (PR open)
- **Effort:** M
- **Depends on:** P1-04
- **Serialize with:** P1-07, P1-16, and any later unit editing `server/gateway/*`
- **Requirement Source:** IMPROVEMENT-PLAN.md Phase 1

## Scope (pure move)
- `server/gateway/index.js`: `attachGateway(httpServer, wss)`. Holds the upgrade auth, heartbeat, the connect frames (`ready`, `unread`, `dm_unread`), and `detachGateway`.
- `server/gateway/router.js`: frame parsing, `GATEWAY_STRING_FIELDS` validation, `rejectFrame`, and an op → handler dispatch table (this replaces the switch).
- `server/gateway/chat.js`: ops `focus`, `read`, `message`, `edit`, `delete`, `react`, `typing`.
- `server/gateway/dm.js`: ops `dm`, `dm_edit`, `dm_delete`, `dm_focus`, `dm_read`, `dm_typing`.
- `server/gateway/voice.js`: `voiceRooms` and the `voice_*` ops, plus `voiceLeave` and `broadcastVoiceState`.
- When done, `server.js` is the composition root and should be under ~120 lines.

## Acceptance criteria
- [x] `api.test.js` passes unmodified. That includes voice signaling, typing relay, 0.1 malformed frames and 0.5 oversized frames.
- [x] Adding a new op means touching only `router.js` (one table entry) and one domain file. Document this in a header comment.
- [x] Exports are unchanged: `{ httpServer, wss, config, db, isWeakSecret, resolveJwtSecret, clientIp }`.
- [x] The heartbeat timer is still `unref()`'d, so tests exit cleanly.

## Expected Areas of Change
`server/server.js`, plus new files `server/gateway/{index,router,chat,dm,voice}.js`.

## Working Set / Blast Radius
- Load: the remaining `server/server.js` (~600 lines at this point) and `gateway/delivery.js`.
- Blast radius: all realtime behaviour. Covered by the tests.
- Hidden coupling: `detachGateway` calls `voiceLeave`, and `delivery.js` owns `userClients`. Voice must import delivery and not the other way round.

## Activation
- Activated 2026-10-15 on branch `claude/p1-05-server-split-gateway`, cut from main @ a876928 (after P1-04 merged).
- Baseline: 29/29 server tests passing (2 suites); `server.js` 443 lines.

## Implementation notes
- Each `case` of the old `switch` is now a method on its domain module's `ops` object. The body is copied verbatim (dedented). It is called as `handler({ ws, msg, userId })`, and each method destructures only the names it uses.
- `router.js` maps op names to handlers in a **`Map`**, so a frame with `op: "constructor"` or `"__proto__"` can't resolve to an inherited object property. That keeps the old switch's "unknown op → ignored" behaviour.
- **Deviation from scope:** `rejectFrame` and `TOO_LONG` live in a small `gateway/frames.js` instead of `router.js`. `chat.js` and `dm.js` need them, and `router.js` imports those modules, so keeping them in the router would create a require cycle.
- `attachGateway(httpServer, wss)` (in `gateway/index.js`) holds the heartbeat (still `unref()`'d) and the `/gateway` upgrade handler. `detachGateway` and `logInfo` moved there too. `voice.js` imports `delivery.js`, never the other way round.

## Verification (AC → evidence)
| AC | Evidence |
|---|---|
| Tests pass unmodified | 29/29 (both suites), covering voice signaling, typing relay, malformed and oversized frames. ESLint `no-undef` / `no-unused-vars`: clean. |
| New op = `router.js` entry + one domain file | `router.js` header comment documents this. The `OPS` table has one line per op. |
| Exports unchanged | `server.js` still exports `{ httpServer, wss, config, db, isWeakSecret, resolveJwtSecret, clientIp }`. It is now 41 lines (composition root). |
| Heartbeat `unref()` | `gateway/index.js:43`. Jest exits cleanly. |
| (extra) live sandbox | Connect frames are `ready, unread, dm_unread`. `op: "constructor"`, `"__proto__"`, non-JSON and `{space:{}}` frames are ignored and the server stays up. A channel message and a DM are delivered. `dm_typing` reaches a focused peer. Voice join on a voice channel gives `voice_peers` + `voice_state`, and leave gives an empty `voice_state`. |
