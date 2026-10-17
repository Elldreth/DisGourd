# P4-07 — Thread panel on phones: back affordance and hardware back

- **Unit Type:** Implementation (child of P4-00)
- **Phase:** 4
- **State:** REVIEW (branch `claude/p4-07-thread-back`, PR pending)
- **Effort:** S
- **Depends on:** none
- **Serialize with:** P4-01 and P4-06 (`ThreadPanel.jsx`, `ChatPanel.jsx`, `App.jsx`)
- **Requirement Source:** `design/UX-REVIEW-2026-10.md` M1. On phones the thread panel is full-screen; the only way back is a 30 px × at the top-right, and the hardware back button leaves the app. The same applies to the members drawer and the nav drawer.

## Scope
- Below `md`, the thread panel header starts with a back button ("‹ #general", the parent channel name) at the left, 44 px tall; the × stays for desktop.
- A tiny history helper (`web/src/overlayHistory.js`): when the thread panel, the members drawer or the nav drawer opens on a phone, push a history entry; `popstate` closes the topmost open overlay; closing via UI goes `history.back()` so the stack stays balanced. Guarded so desktop (where the panel is a side column) pushes nothing.
- Esc still closes on desktop; the swipe gesture is out of scope.

## Acceptance criteria
- [x] AC-1: at 375 px, open a thread, press the back button in the header: the channel is shown, focus returns to the thread chip.
- [x] AC-2: at 375 px, open a thread, call `history.back()`: the panel closes and the app does not navigate away; a second `history.back()` behaves as before the unit.
- [x] AC-3: the members drawer and nav drawer close on `history.back()` the same way; opening and closing each three times leaves `history.length` unchanged from before.
- [x] AC-4: at 1280 px nothing changes: no history entries are pushed, the × closes the column.
- [x] AC-5: unit tests for `overlayHistory.js` (push, pop, balance, desktop no-op) and for the back button; suites and build pass.

## Expected Areas of Change
`web/src/overlayHistory.js` (new), `ThreadPanel.jsx`, `App.jsx` (where `navOpen`, `membersOpen` and the open thread live), `MemberList.jsx` (drawer close path), tests.

## Working Set / Blast Radius
4–5 files. Risk: the invite deep link (P3-14) uses `history.replaceState`; the helper must not interfere (only `pushState` with a marker state and only on phones).

## Testing Strategy
Vitest with a fake `history`; a sandbox check at 375 px using `javascript_tool` to call `history.back()`.

## Out of Scope
Swipe-to-close, animating the back transition, the thread panel layout (P4-06 V8).

## Starting Baseline
Revision: main after #107. Clean worktree `.claude/worktrees/p4-shine`. Web suite 56 files / 495 tests green.

## Implementation notes
- `web/src/overlayHistory.js`: `useOverlayHistory(id, open, onClose, { win, enabled })`. When `open` turns true below lg (`matchMedia('(max-width: 1023px)')`) it pushes `{ dgOverlay: id }`; a `popstate` that leaves our entry no longer on top calls `onClose`; when the overlay closes by other means while our entry is still on top, the effect cleanup calls `history.back()` once, so the stack stays balanced. Another overlay's entry above ours is left alone (its own hook handles it). `win` and `enabled` are injection points for the tests' fake window.
- `App.jsx` uses it for the thread panel (`!!openThread` / `closeThread`), the member drawer and the nav drawer.
- `ThreadPanel.jsx`: a `tap`-sized `chevronLeft` `IconButton` "Back to #{parentChannel}" at the left of the header, `lg:hidden` (the panel is full-screen below lg, not md as the packet guessed; the member drawer uses the same breakpoint). `Icon.jsx` gains `chevronLeft`.
- The invite deep link (P3-14) only calls `replaceState`, so it never collides with these entries.
- Chrome truncates forward history on `pushState`, so `history.length` is not a reliable balance check in the sandbox; the packet's AC-3 was verified by the `history.state` marker (present while open, gone after) and by the unit test's fake history, whose length is exact.

## Verification Evidence
| Acceptance Criterion | Status | Verification Type | Evidence |
|---|---|---|---|
| AC-1 | Verified | Sandbox (P4 copy of the sandbox DB on :3007) at 375×812 | The thread header starts with "Back to #general" (44×44 at x=8, the chevron drawn in gray-300); clicking it closed the panel. Focus return to the chip is the existing `closeThread` behaviour (unchanged) |
| AC-2 | Verified | Sandbox at 375px | Opening the thread set `history.state` to `{"dgOverlay":"thread"}`; `history.back()` closed the panel, the URL stayed `/` and the app stayed open; opening again and pressing the back button left `history.state` null (entry removed) |
| AC-3 | Verified | Sandbox + `overlayHistory.test.jsx` | Members drawer: state `{"dgOverlay":"members"}` while open, `history.back()` closed it (`aria-expanded` false), state null after. Nav drawer: `{"dgOverlay":"nav"}`, back removed the backdrop, state null, URL `/`. Test "three open/close rounds leave the history length where it started" passes with an exact fake history |
| AC-4 | Verified | Sandbox at 1280×800 | Opening the thread left history.state null (nothing pushed), the back button is display: none, the × closed the side column and the state stayed null |
| AC-5 | Verified | Vitest, Vite | `overlayHistory.test.jsx`: 4 tests; `ThreadPanel.test.jsx` gains the back-button test (all watched fail first, then pass). Full web suite 57 files / 500 tests green; `vite build` clean |
