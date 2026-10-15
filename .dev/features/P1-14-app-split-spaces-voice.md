# P1-14 — App.jsx split 3/3: spaces/members/navigation + voice-call hooks

- **Unit Type:** Implementation
- **Phase:** 1 — "Split up App.jsx"
- **State:** PLANNED (READY when P1-13 is merged)
- **Effort:** M
- **Depends on:** P1-13
- **Serialize with:** App.jsx units
- **Requirement Source:** IMPROVEMENT-PLAN.md Phase 1

## Scope (behaviour-preserving)
- `web/src/state/useSpaces.js`: owns `spaces`, `serverOrder`, `currentSpace`, `currentChannel`, `members` and `loadError`. Also takes the server actions (create, join, createChannel, invite, role, kick, delete, rename, icon); saved-view restore and persist; and the handlers `channel_created`, `channel_deleted`, `space_*`, `members_changed`, `presence`.
- `web/src/state/useVoiceCall.js`: owns `voiceRef`, `voiceCall`, `voiceStates`, the voice keyboard shortcuts effect, the `voice_*` handlers, and the voice actions.
- Afterwards App.jsx is mostly layout plus wiring. Target: under 400 lines.

## Acceptance criteria
- [ ] App.jsx ≤ 400 lines.
- [ ] Manual smoke: create/join/rename/delete a server, change and reframe the icon, change a role, kick, reorder the rail, refresh-restore. Voice: join, mute (Ctrl+Shift+M), deafen, PTT, camera, screen share, leave.
- [ ] Build passes.

## Expected Areas of Change
`web/src/App.jsx`, new `web/src/state/useSpaces.js`, new `web/src/state/useVoiceCall.js`.

## Working Set / Blast Radius
App.jsx plus `voice.js` (read-only, for its API). Large surface area. A behaviour-neutral refactor validated by the manual checklist.
