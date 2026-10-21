# P10-07 — Small things: transfer button and list, ☰ badge dot, light amber badge

- **Unit Type:** Implementation (child of P10-00)
- **Phase:** 10
- **State:** COMPLETE (merged in #208)
- **Effort:** S
- **Depends on:** none
- **Serialize with:** none
- **Requirement Source:** `design/design-review-p10/REVIEW.md` T1, T2, N1, N2.

## Scope
- Danger zone: Transfer ownership… becomes an outlined neutral button; Delete server keeps the danger style.
- Transfer dialog: avatars and each member's top role.
- Phones: a dot on the channel header's ☰ when something is waiting: red for unread DMs or mentions, amber for reports.
- Light theme: the rail's amber report count uses a darker amber fill that passes 4.5:1 with its number.

## Acceptance criteria
- [x] AC-1: at 375×812 with an unread DM, the ☰ shows a red dot, with "(unread)" in its label.
- [x] AC-2: the light-theme report badge's number has ≥4.5:1 contrast (measured).
- [x] AC-3: the transfer dialog's rows show avatar and role.

## Expected Areas of Change
OverviewSection.jsx, TransferDialog.jsx, the channel header in App.jsx, ServerRail.jsx, tests.

## As built
- **Danger zone** (`OverviewSection`): **Transfer ownership…** is a neutral outlined button. Delete server keeps the danger style.
- **`TransferDialog`:**
  - Each candidate shows their avatar and their top role (from the server's `roles`, which `ChannelList` now passes through). The radio's name reads "bob, Mods".
  - Found by axe and fixed here: the list was a `<ul role="radiogroup">` holding `<li>` items (serious); it's now plain `div`s.
- **`NavButton.jsx`** (new) replaces the four ☰ buttons in `ChatPanel` and `DmPanel` (headers and empty screens). `navAlert()` picks the dot: red for unread DMs or any mention, amber for open reports, red winning. The label says "Channels (unread)" or "Channels (open reports)". `App` works it out from the counts it already has.
- **The light-theme amber count:** measured live, it's #875500 behind #eae5f7 text, **5.1:1**, already above 4.5:1. The review called it muddy, but it passes, so it's unchanged.

## Verification Evidence
| Acceptance Criterion | Status | Verification Type | Evidence |
|---|---|---|---|
| AC-1 | Verified | `NavButton.test.jsx` + sandbox 375×812 | sandy (3 open reports) sees an amber dot, labelled "Channels (open reports)"; red wins in the test (`shots/p10-07-phone-menu-dot.jpg`) |
| AC-2 | Verified | Measured (computed colours) | 5.1:1; no change needed |
| AC-3 | Verified | `Transfer.test.jsx` + sandbox | "bob · Mods" with avatars (`shots/p10-07-transfer-dialog.jpg`); Transfer is neutral (`shots/p10-07-danger-zone.jpg`) |
| Accessibility | Verified | axe-core 4.10.2 | The transfer dialog is clean after the list fix |
| Suites | Verified | Vitest, Jest, Vite | Web 106 files / 837 tests; server 53 suites / 461 tests; `vite build` clean |

## Discovered Work (not done here)
- axe (serious, `scrollable-region-focusable`): a code block (`<pre>`) in a chat message scrolls sideways on a phone but can't take keyboard focus. That's message rendering, not this pass; a `tabIndex={0}` on scrollable code blocks would fix it.

## kie.ai spend
None.

## Not in scope
Anything not listed above. Other findings in the review belong to their own pass.
