# P1-05 — Server split 4/4: gateway (router, chat, dm, voice)

- **Unit Type:** Implementation
- **Phase:** 1 — "Split server.js" (`gateway/{router,voice}`)
- **State:** PLANNED (READY when P1-04 merged)
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
- [ ] `api.test.js` passes unmodified. That includes voice signaling, typing relay, 0.1 malformed frames and 0.5 oversized frames.
- [ ] Adding a new op means touching only `router.js` (one table entry) and one domain file. Document this in a header comment.
- [ ] Exports are unchanged: `{ httpServer, wss, config, db, isWeakSecret, resolveJwtSecret, clientIp }`.
- [ ] The heartbeat timer is still `unref()`'d, so tests exit cleanly.

## Expected Areas of Change
`server/server.js`, plus new files `server/gateway/{index,router,chat,dm,voice}.js`.

## Working Set / Blast Radius
- Load: the remaining `server/server.js` (~600 lines at this point) and `gateway/delivery.js`.
- Blast radius: all realtime behaviour. Covered by the tests.
- Hidden coupling: `detachGateway` calls `voiceLeave`, and `delivery.js` owns `userClients`. Voice must import delivery and not the other way round.
