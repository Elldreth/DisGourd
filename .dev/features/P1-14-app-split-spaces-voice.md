# P1-14 — App.jsx split 3/3: spaces/members/navigation + voice-call hooks

- **Unit Type:** Implementation
- **Phase:** 1 — "Split up App.jsx"
- **State:** COMPLETE (merged in Elldreth/DisGourd#55)
- **Effort:** M
- **Depends on:** P1-13
- **Serialize with:** App.jsx units
- **Requirement Source:** IMPROVEMENT-PLAN.md Phase 1

## Scope (behaviour-preserving)
- `web/src/state/useSpaces.js`: owns `spaces`, `serverOrder`, `currentSpace`, `currentChannel`, `members` and `loadError`. Also takes the server actions (create, join, createChannel, invite, role, kick, delete, rename, icon); saved-view restore and persist; and the handlers `channel_created`, `channel_deleted`, `space_*`, `members_changed`, `presence`.
- `web/src/state/useVoiceCall.js`: owns `voiceRef`, `voiceCall`, `voiceStates`, the voice keyboard shortcuts effect, the `voice_*` handlers, and the voice actions.
- Afterwards App.jsx is mostly layout plus wiring. Target: under 400 lines.

## Acceptance criteria
- [x] App.jsx ≤ 400 lines.
- [~] Manual smoke: create/join/rename/delete a server, change and reframe the icon, change a role, kick, reorder the rail, refresh-restore. Voice: join, mute (Ctrl+Shift+M), deafen, PTT, camera, screen share, leave.
- [x] Build passes.

## Expected Areas of Change
`web/src/App.jsx`, new `web/src/state/useSpaces.js`, new `web/src/state/useVoiceCall.js`.

## Working Set / Blast Radius
App.jsx plus `voice.js` (read-only, for its API). Large surface area. A behaviour-neutral refactor validated by the manual checklist.

## Activation
- Activated 2026-10-15 on branch `claude/p1-14-spaces-voice-hooks`, cut from main @ 9421165 (P1-13 merged).
- Baseline: App.jsx 733 lines.

## Implementation notes
- `web/src/state/useSpaces.js` (306 lines) owns:
  - **State:** spaces and rail order, the open server and channel, members, the error toast, invite code, and icon framing.
  - **Derived:** active space, channels, voice channels, role, `canManage`, `canPostCurrent`, `canModerate`.
  - **Effects:** initial load and saved-view restore (via an `onRestoreDm` callback), view persistence (it takes `view` and `dmCurrent`), the hidden-channel fallback, and member reloads.
  - **Handlers:** `presence`, `channel_*`, `space_*`, `members_changed`.
  - **Actions:** all server, channel and member actions. A small `attempt(failure, fn)` wrapper replaces the repeated try/catch, with identical error messages.
- `web/src/state/useVoiceCall.js` (106 lines) owns the controller, the call state, per-channel participants (`participantsFor`), the keyboard shortcuts, the `voice_*` handlers, and every call action including `applyOutput`.
- **App.jsx is now 337 lines: layout plus wiring.** Hooks are called in dependency order (gateway → voice → DMs → spaces → channel messages), so nothing reads a hook result before it's declared. That's the crash class found in P1-13. `eslint no-use-before-define` and `no-undef` on App and `state/*`: clean.
- The `api.getMe()` profile load moved into its own small effect in App.

## Discovered work (not done here: behaviour-preserving refactor)
- Creating (or joining) a server while the DM view is open stays on DMs. The new server appears in the rail but isn't opened. This was **pre-existing** (the old `createSpace` / `joinServer` never set the view either). It's a one-line fix (`setView('server')` in App's wrappers), for a follow-up such as P3-04 (create/join dialog).

## Verification (AC → evidence)
| Item | Evidence |
|---|---|
| App.jsx ≤ 400 | **733 → 337.** |
| Create server | UI: Create a server, "Split Check", which appears in the rail (stays in DMs; see Discovered work). |
| Invite / member join | "Invite people" dialog with a code; bob joined with it via the API. Sandy's member list went live to "Members — 2". |
| Change role | Member menu, "Make admin": bob shows ADMIN. |
| Kick | "Remove from server" asks "Remove bob from the server?" (confirm stubbed); members drop to 1. |
| Rename | Server menu rename to "Split Renamed": header and rail updated. |
| Change icon / reframe | A generated PNG on the icon input opens the cropper; Save sets the rail icon to `/uploads/…/icon-test.png`. "Reposition icon" reopens the cropper on the original. |
| Reorder rail | Dragged "Split Renamed" to the top; order saved to localStorage. |
| Refresh-restore | After reload: same server/channel (`#general` in Split Renamed) and the same rail order. The earlier load also restored the last DM (cara). |
| Delete server | Confirm "Delete the server "Split Renamed" for everyone?…", then removed and moved to the first remaining server. |
| Voice: join / deafen shortcut / leave | Created voice channel "hangout" via UI; joined it, showing "Voice connected" and sandy listed. Ctrl+Shift+D toggled Deafen ↔ Undeafen both ways. Leave disconnected and emptied the participant list. |
| **Not exercised** | **Mute (Ctrl+Shift+M), push-to-talk, camera, screen share**: the browser pane blocks microphone and camera, so the app correctly ran listen-only (no mute control). **Join a server through the UI join dialog**: the join was done via the API. These code paths were moved verbatim and need a real-browser check. |
| Build / runtime | `vite build` clean. No `window` errors recorded during the whole run. |
