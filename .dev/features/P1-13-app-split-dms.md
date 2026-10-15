# P1-13 — App.jsx split 2/3: DM state hook

- **Unit Type:** Implementation
- **Phase:** 1 — "Split up App.jsx"
- **State:** COMPLETE (merged in Elldreth/DisGourd#54)
- **Effort:** S–M
- **Depends on:** P1-12 (handler registry pattern)
- **Serialize with:** App.jsx units
- **Requirement Source:** IMPROVEMENT-PLAN.md Phase 1

## Scope (behaviour-preserving)
New `web/src/state/useDms.js` owns `dms`, `currentDm`, `dmMessages`, `dmUnread` and `dmTyping`, the DM focus/load effect, the `loadDms`/`startDm`/`selectDm` actions, and the handlers `dm`, `dm_update`, `dm_delete`, `dm_typing`, `dm_unread`. It reuses the message reducer from P1-12.

## Acceptance criteria
- [x] App.jsx shrinks by ≥ 100 more lines.
- [x] Manual smoke: send, edit and delete a DM; unread badge per conversation and on the rail; typing indicator; starting a DM from the member list; opening a DM from search; the saved view restores the DM after a refresh.
- [x] Build passes.

## Expected Areas of Change
`web/src/App.jsx`, new `web/src/state/useDms.js`.

## Working Set / Blast Radius
App.jsx and the P1-12 hook. Affects DMs only.

## Activation
- Activated 2026-10-15 on branch `claude/p1-13-dm-hook`, cut from main @ 1490e13 (P1-08 merged).
- Baseline: App.jsx 851 lines.

## Implementation notes
- `web/src/state/useDms.js` owns:
  - **State:** the conversation list, the open partner (`current`), messages (via the shared `messagesReducer`), per-conversation unread, typing, and history paging (from P1-08).
  - **Effects:** the focus/load effect and typing pruning.
  - **Handlers:** `dm`, `dm_update`, `dm_delete`, `dm_typing`, `dm_unread`, registered through the P1-12 handler table.
  - **Actions:** `select`, `open` (adds to the list), `loadConversations`, `loadOlder`, `send`, `edit`, `remove`, `sendTyping`, `reset`.
- App keeps `view` (server vs DM) and wraps `selectDm`/`startDm`/`openDms` around the hook.
- **Bug found and fixed during verification:** the "persist view" effect read `dm.current` in its dependency array but sat *above* `const dm = useDms(...)`, so every page load crashed (`Cannot access … before initialization`, blank screen). `vite build` doesn't catch this. The effect now sits below the hook.

## Discovered work (not done here)
- A runtime render smoke test would have caught the crash above, which neither `vite build` nor CI can. That belongs in **P1-19** (web test harness): render `<App/>` with a stubbed API and fail on errors.

## Verification (AC → evidence)
| AC | Evidence |
|---|---|
| App.jsx −100 more lines | 851 → **733** (−118). |
| Saved view restores the DM after refresh | The reload landed back in the DM with bob (composer "Message @bob", history loaded). |
| Send / edit / delete / typing (live, second client) | Bob (scripted) sent "dm hook check from bob". His edit showed "(edited)". "bob is typing" showed and expired within 5s. His delete removed the message. Sandy's own DM from the composer appeared. |
| Unread badge per conversation and on the rail | While Sandy was in a server, bob sent 2 DMs and the rail's Direct Messages button showed **2**. A third user (cara) sent 3 while Sandy had bob's DM open: cara's row moved to the top with a **3** badge and the list refreshed live. |
| Start a DM from the member list | Tx Check member list, bob, then "Message": DM view with bob opened. |
| Open a DM from search | Searching "hi from cara" and clicking the result opened cara's DM, and her badge cleared. |
| Build | `vite build`: clean. No console errors from the current bundle (the logged errors came from the pre-fix bundle, `index-DFQf2EXk.js`). |
