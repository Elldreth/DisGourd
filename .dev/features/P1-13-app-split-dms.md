# P1-13 — App.jsx split 2/3: DM state hook

- **Unit Type:** Implementation
- **Phase:** 1 — "Split up App.jsx"
- **State:** PLANNED (READY when P1-12 is merged)
- **Effort:** S–M
- **Depends on:** P1-12 (handler registry pattern)
- **Serialize with:** App.jsx units
- **Requirement Source:** IMPROVEMENT-PLAN.md Phase 1

## Scope (behaviour-preserving)
New `web/src/state/useDms.js` owns `dms`, `currentDm`, `dmMessages`, `dmUnread` and `dmTyping`, the DM focus/load effect, the `loadDms`/`startDm`/`selectDm` actions, and the handlers `dm`, `dm_update`, `dm_delete`, `dm_typing`, `dm_unread`. It reuses the message reducer from P1-12.

## Acceptance criteria
- [ ] App.jsx shrinks by ≥ 100 more lines.
- [ ] Manual smoke: send, edit and delete a DM; unread badge per conversation and on the rail; typing indicator; starting a DM from the member list; opening a DM from search; the saved view restores the DM after a refresh.
- [ ] Build passes.

## Expected Areas of Change
`web/src/App.jsx`, new `web/src/state/useDms.js`.

## Working Set / Blast Radius
App.jsx and the P1-12 hook. Affects DMs only.
