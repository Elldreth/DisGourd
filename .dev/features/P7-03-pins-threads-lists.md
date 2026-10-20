# P7-03 — Pins and Threads lists: review several without reopening

- **Unit Type:** Implementation
- **Phase:** 7 (UX review follow-ups)
- **State:** COMPLETE (merged #173; option A, a side panel, chosen by the owner on 2026-10-20)
- **Effort:** M
- **Depends on:** none
- **Serialize with:** none
- **Requirement Source:** `design/UX-REVIEW-2026-10.md` F5; recorded as a follow-up in `P4-00`.

## What's there now (checked against main)
The review saw popovers. Since then, both lists became **modals** over the chat (`PinsPanel.jsx`, `ThreadsList.jsx`), with a dimmed backdrop. They close on Esc, the X, or a backdrop click; that part is already fine. The remaining problem: opening a pin closes the list and jumps (`onClose(); onJump(id)`), so reviewing several pins means opening the list again each time. A modal can't simply stay open, because it covers the message you jumped to.

## Options (A chosen by the owner, 2026-10-20)
- **A. Side panel (recommended).**
  - Pins and Threads open in the right-hand column, where the thread panel opens, instead of over the chat.
  - The list stays open while you jump from pin to pin, and the jumped-to message is visible beside it.
  - On phones it's full-screen with a back button, as the thread panel is (P4-07).
  - **M.**
- **B. Keep the modal, add "Jump and keep the list":** jumping closes the list, and a small "Back to pins" chip appears above the message box to reopen it at the same scroll position. **S.**
- **C. Leave it as it is:** close the follow-up as "superseded by the modal".

## Acceptance criteria (option A)
- [x] AC-1: Pins and Threads open in the right-hand column on desktop. The chat stays visible and usable.
- [x] AC-2: jumping to a pin keeps the list open and highlights the message, so you can step through several pins.
- [x] AC-3: opening a thread from the Threads list replaces the list with that thread's panel, as today.
- [x] AC-4: Esc and the X close it. On phones it's full-screen with a back button, and hardware back closes it (the `overlayHistory` from P4-07).
- [x] AC-5: web tests for AC-1 to AC-4 (the jump flow and phone back), and the existing Pins and Threads tests are updated. The suite stays green.
- [x] AC-6: a sandbox check at desktop and phone width, with screenshots.

## Expected Areas of Change (option A)
`PinsPanel.jsx`, `ThreadsList.jsx`, `App.jsx` (which side panel is open), `ChatPanel.jsx` (the header buttons), `overlayHistory.js`, plus tests.

## Starting Baseline
Revision: `ee16b7e` (main after #168).

## Implementation notes
- **`SidePanel.jsx` (new):** the side column, with the thread panel's layout. It's `fixed inset-0` on phones, with a back chevron, and `lg:static lg:w-96` from lg up, with an X. Esc inside it closes it, and it takes focus when it opens.
- **The lists:** `PinsPanel` and `ThreadsList` render in it instead of a `Modal`. A pin's Jump no longer closes the list; ThreadsList opens the thread first, then closes.
- **`ChatPanel`:** wraps the chat `<main>` and the side column in a row. `openSide(which)` toggles a list, closes the other one, and asks App to close an open thread quietly (`onCloseThread`). `threadOpen` closes the lists when a thread opens.
  - Closing gives focus back to the button that opened it.
  - On a phone (max-width 1023px), a jump closes Pins so the message is visible.
  - `useOverlayHistory('pins' | 'threads')` makes the hardware back button close them.
- **Not re-indented:** the chat `<main>` wasn't re-indented inside the new wrapper, to keep the diff readable.
- **Seen in passing (not changed):** the "A new version of DisGourd is ready" notice sits above side panels on phones, as it already did over the thread panel. It only appears after a deploy.

## Verification Evidence
| Acceptance Criterion | Status | Verification Type | Evidence |
|---|---|---|---|
| AC-1 | Verified | Vitest `SidePanels.test.jsx` + sandbox | A `complementary` region outside `<main>`, `lg:static lg:w-96`, no dialog, and it takes focus. Sandbox at 1280×800: Pins beside the chat in #history (`design/p6-actions/shots/p7-03-pins-first-jump.jpg`). |
| AC-2 | Verified | Vitest + sandbox | Two jumps in a row with the list still open (test). Sandbox: jumped to "filler 190", then to "live again"; each was highlighted and the list stayed (`p7-03-pins-first-jump.jpg`, `p7-03-pins-second-jump.jpg`). |
| AC-3 | Verified | Vitest + sandbox | Opening "router…" from Threads in #general showed the thread panel in the column (`p7-03-threads-list.jpg` → `p7-03-thread-replaces-list.jpg`). Opening Pins while a thread was open left only Pins (the DOM had one `complementary`). Threads replaces Pins and the reverse; the buttons toggle. |
| AC-4 | Verified | Vitest + sandbox at 375×812 | Esc, the X (desktop) and the back chevron (phone) close it, and focus goes back to the Pins button. Phone: full screen (`p7-03-phone-pins.jpg`). `history.state` is `{dgOverlay: 'pins'}` while open; `history.back()` closes it. A phone jump closes it and cleans up the history entry. |
| AC-5 | Verified | Vitest, Vite | `SidePanels.test.jsx` (6 new), `PinsPanel.test.jsx` updated (a jump no longer closes; two jumps in a row), `ThreadsList.test.jsx` unchanged and green. Web 95 files / 747 tests green. `vite build` clean. |
| AC-6 | Verified | Sandbox (a copy of the sandbox DB on :3007, this branch's web build) | As above, at desktop and phone width. No console errors. Two pins were added to #history in the sandbox copy for the check. |
