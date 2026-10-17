# P4-07 — Thread panel on phones: back affordance and hardware back

- **Unit Type:** Implementation (child of P4-00)
- **Phase:** 4
- **State:** READY
- **Effort:** S
- **Depends on:** none
- **Serialize with:** P4-01 and P4-06 (`ThreadPanel.jsx`, `ChatPanel.jsx`, `App.jsx`)
- **Requirement Source:** `design/UX-REVIEW-2026-10.md` M1. On phones the thread panel is full-screen; the only way back is a 30 px × at the top-right, and the hardware back button leaves the app. The same applies to the members drawer and the nav drawer.

## Scope
- Below `md`, the thread panel header starts with a back button ("‹ #general", the parent channel name) at the left, 44 px tall; the × stays for desktop.
- A tiny history helper (`web/src/overlayHistory.js`): when the thread panel, the members drawer or the nav drawer opens on a phone, push a history entry; `popstate` closes the topmost open overlay; closing via UI goes `history.back()` so the stack stays balanced. Guarded so desktop (where the panel is a side column) pushes nothing.
- Esc still closes on desktop; the swipe gesture is out of scope.

## Acceptance criteria
- [ ] AC-1: at 375 px, open a thread, press the back button in the header: the channel is shown, focus returns to the thread chip.
- [ ] AC-2: at 375 px, open a thread, call `history.back()`: the panel closes and the app does not navigate away; a second `history.back()` behaves as before the unit.
- [ ] AC-3: the members drawer and nav drawer close on `history.back()` the same way; opening and closing each three times leaves `history.length` unchanged from before.
- [ ] AC-4: at 1280 px nothing changes: no history entries are pushed, the × closes the column.
- [ ] AC-5: unit tests for `overlayHistory.js` (push, pop, balance, desktop no-op) and for the back button; suites and build pass.

## Expected Areas of Change
`web/src/overlayHistory.js` (new), `ThreadPanel.jsx`, `App.jsx` (where `navOpen`, `membersOpen` and the open thread live), `MemberList.jsx` (drawer close path), tests.

## Working Set / Blast Radius
4–5 files. Risk: the invite deep link (P3-14) uses `history.replaceState`; the helper must not interfere (only `pushState` with a marker state and only on phones).

## Testing Strategy
Vitest with a fake `history`; a sandbox check at 375 px using `javascript_tool` to call `history.back()`.

## Out of Scope
Swipe-to-close, animating the back transition, the thread panel layout (P4-06 V8).

## Verification Evidence
| Acceptance Criterion | Status | Verification Type | Evidence |
|---|---|---|---|
| AC-1 | Not verified | | |
| AC-2 | Not verified | | |
| AC-3 | Not verified | | |
| AC-4 | Not verified | | |
| AC-5 | Not verified | | |
