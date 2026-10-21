# P10-07 — Small things: transfer button and list, ☰ badge dot, light amber badge

- **Unit Type:** Implementation (child of P10-00)
- **Phase:** 10
- **State:** PLANNED
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
- [ ] AC-1: at 375×812 with an unread DM, the ☰ shows a red dot, with "(unread)" in its label.
- [ ] AC-2: the light-theme report badge's number has ≥4.5:1 contrast (measured).
- [ ] AC-3: the transfer dialog's rows show avatar and role.

## Expected Areas of Change
OverviewSection.jsx, TransferDialog.jsx, the channel header in App.jsx, ServerRail.jsx, tests.

## Not in scope
Anything not listed above. Other findings in the review belong to their own pass.
