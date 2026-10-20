# P6-04 — Leftovers: server rename keeps calls, countdowns follow renames, duplicate CSS

- **Unit Type:** Implementation
- **Phase:** 6
- **State:** REVIEW
- **Effort:** S
- **Depends on:** P6-03 (merged in #168)
- **Serialize with:** none open
- **Requirement Source:** P6-03 Discovered Work (`P6-03-rename-channel.md`), P5-02 note on the duplicate tap utilities. The owner said to go ahead on 2026-10-20.

## Scope
1. **Server rename keeps calls.** `voiceRenameSpace(old, new)` in `gateway/voice.js` re-keys every room of the server, points member sockets at the new key, and resends `voice_state`. The server-rename route calls it right after sending `space_renamed`. On the client, `voice.js` `renameSpace` and a `space_renamed` handler in `useVoiceCall` (the call and the per-channel voice states) follow along.
2. **Slow-mode countdowns follow renames.** `renameCooldowns(space, channel, newSpace, newChannel)` in `slowmode.js`; `channel` null moves the whole server. App calls it on `channel_renamed` and `space_renamed`. On `space_renamed`, an open thread also follows the server name.
3. **Duplicate CSS.** `web/src/index.css` had two identical copies of the `tap`, `tap-row`, `tap-chip` and `tap-reaction` utilities; one is removed.

## Acceptance criteria
- [x] AC-1: after a server rename, someone in a voice channel there stays in the room. `voice_state` arrives under the new server name, after `space_renamed`; there's no `voice_ended`. Other servers' rooms are untouched. A new connection sees the room under the new name; mute and leave still work.
- [x] AC-2: on the client, the call's room follows a channel or server rename, and a rejoin uses the new names.
- [x] AC-3: a running slow-mode countdown keeps its time after a channel rename (that channel only) or a server rename (all its channels and threads, and only that server).
- [x] AC-4: `index.css` has one copy of each tap utility; the build is unchanged otherwise.
- [x] AC-5: server tests are in `server/tests/rename-server-voice.test.js`, and web tests in `slowmodeRename.test.js` and `voice.test.js`. Full suites are green.
- [x] AC-6: a sandbox check: bob, in a voice call, stays connected when sandy renames the server.

## Starting Baseline
Revision: `ee16b7e` (main after #168).

## Verification Evidence
| Acceptance Criterion | Status | Verification Type | Evidence |
|---|---|---|---|
| AC-1 | Verified | Jest `rename-server-voice.test.js` (3 tests; all 3 fail with the `voiceRenameSpace` call commented out) | The ordering, no `voice_ended`, the other server untouched, the late connection, mute and leave are all asserted. |
| AC-2 | Verified | Vitest `voice.test.js` | `renameRoom` and `renameSpace` ignore other rooms and servers and move ours. The new name's roster is accepted, and a rejoin sends the new names. |
| AC-3 | Verified | Vitest `slowmodeRename.test.js` | A channel rename moves only that countdown. A server rename moves its channels and thread, and not another server's. |
| AC-4 | Verified | Diff + Vite | The two blocks were checked identical before one was removed. `@utility tap {` now appears once. `vite build` clean. |
| AC-5 | Verified | Jest, Vitest | Server 46 suites / 418 tests, web 95 files / 744 tests, all green. |
| AC-6 | Verified | Sandbox (a copy of the sandbox DB on :3007, this branch's code), listen-only voice | bob in "hangout · Tx Check" (`design/p6-actions/shots/p6-04-call-before.png`). After sandy renamed the server to Tx Studio, it showed "hangout · Tx Studio" with bob still listed (`p6-04-call-after-server-rename.jpg`). No console errors. The server was renamed back afterwards. The countdown wasn't checked in the browser (bob is a moderator, so slow mode doesn't apply to him); the unit tests cover it. |
