# P10-01 — Reports: grouped cards, action hierarchy, nav count, quoted dialog, empty state, menu groups

- **Unit Type:** Implementation (child of P10-00)
- **Phase:** 10
- **State:** COMPLETE (merged #202)
- **Effort:** M
- **Depends on:** P10-00 (decision 3); P10-08 for the empty-state pose (optional)
- **Serialize with:** P10-03 (`MessageList.jsx` message menu)
- **Requirement Source:** `design/design-review-p10/REVIEW.md` R1–R6, X1.

## Scope
- One card per reported message (grouped by `messageId`; a deleted message groups by excerpt and author). It shows every reason, note and reporter, e.g. "Spam ×2 · reported by cara and dee".
- Actions: the excerpt and "#channel" open the message; **Mark handled** is the filled button and **Dismiss** a text button. Delete message, Time out… and Ban… sit in one **Act on <name> ▾** menu, ranked as today.
- An amber count beside Moderation › Reports in Server settings (desktop and the phone list).
- The Report dialog quotes the message (two lines). The reason chips are a 2×2 grid.
- An empty Open tab uses the shared empty state (the "all clear" pose if P10-08 has landed, else the existing art).
- The message menu gets dividers: everyday actions / Report… and Block… / Delete.
- Bug X1: at 375 px, Server menu › Reports opens the Reports page, not the section list.
- Counts on the rail, the menu and the tab follow decision 3 (messages or reports).

## Acceptance criteria
- [x] AC-1: two reports on one message render as one card listing both reporters; handling it closes both and the card leaves.
- [x] AC-2: at 375×812 each card's actions fit on one row; no horizontal scroll.
- [x] AC-3: Act on ▾ hides actions the moderator can't use (same rank rules as today).
- [x] AC-4: Server settings shows the open count next to Reports; it updates on `reports_changed`.
- [x] AC-5: the Report dialog shows the message's text.
- [x] AC-6: at 375×812, Server menu › Reports lands on the Reports page (test + sandbox).
- [x] AC-7: axe clean on the Reports page and the Report dialog, in both themes.

## Expected Areas of Change
ReportsSection.jsx, ReportDialog.jsx, MessageList.jsx (menu), ServerSettingsDialog.jsx, SettingsLayout.jsx, tests.

## As built
- **`ReportsSection.jsx`:**
  - `groupReports()` makes one card per message (a deleted message's reports group by author and excerpt). Each card shows each reason once with ×n, and "reported by dee, ada (“rude”) and bob".
  - The quote is the jump button.
  - **Mark handled** is the filled button and **Dismiss** a text one.
  - **Act on <name> ▾** opens the shared `ActionMenu` with Delete message, Time out… and Ban…, as the rank rules allow. It opens upward in the lower part of the window.
  - Resolving a message closes all its reports with one call. A deleted message's reports are closed one by one, since they no longer share a message.
- **The count is by message (decision 3):** `db.countOpenReports` counts distinct messages, so the rail, the server menu, the Open tab and `reports_changed` all agree. That's a one-query server change; there's no new route.
- **Server settings list:** sections can carry a `badge` (`SettingsLayout`), and Reports shows the amber count, named "n open" for screen readers.
- **Report dialog:** it quotes the message (`excerpt`, from `notificationText`, clamped to two lines), and the reasons are a 2×2 grid.
- **The empty queue:** `EmptyState` gains the `clear` art (the P10-08 pose), with "Nothing to look at. Nice."
- **Message menu:** items carry a `group`, and `ActionMenu` draws a divider where the group changes: everyday actions | Report…, Block … | Delete message. Report now comes before Block.
- **Bug X1, the phone deep link:**
  - *Cause:* closing the nav drawer calls `history.back()`, which runs later. Server settings had already pushed its phone "page" entry, so that back popped the new entry and flipped the window to its list.
  - *Fix:* `useOverlayHistory` now waits for a pending back of its own before pushing. A new test with an asynchronous fake history fails on the old code and passes now.

## Verification Evidence
| Acceptance Criterion | Status | Verification Type | Evidence |
|---|---|---|---|
| AC-1 | Verified | `Reports.test.jsx` + sandbox | Three reports on one message are one card. One resolve call closes them. Sandbox: "Spam ×2 … reported by cara and dee" (`shots/p10-01-reports.jpg`) |
| AC-2 | Verified | Sandbox 375×812 | Each card's actions are on one row (`shots/p10-01-phone-reports.jpg`) |
| AC-3 | Verified | Test | Ban hidden without permission; a higher-ranked author gets no menu; a deleted message offers Time out only (`shots/p10-01-act-on-menu.jpg`) |
| AC-4 | Verified | Test + sandbox | The tab reads "Reports 2 open" and follows `openCount` |
| AC-5 | Verified | Test + sandbox | `shots/p10-01-report-dialog.jpg` |
| AC-6 | Verified | `overlayHistory.test.jsx` + sandbox | At 375 px: ☰ → server menu → Reports opens with `data-view="page"` on Reports |
| AC-7 | Verified | axe-core 4.10.2 | The Reports page (dark and light) and the Report dialog: no violations |
| Count by message | Verified | `server/tests/reports.test.js` | Open count = distinct messages, fewer than reports |
| Suites | Verified | Vitest, Jest, Vite | Web 104 files / 823 tests; server 53 suites / 461 tests; `vite build` clean |

## Not checked
- The sandbox server on :3005 runs main's code, so its rail showed 4 (reports) during the live check. On this branch's server it would be 3 (messages); the server test covers that.

## kie.ai spend
None (the pose came from P10-08).

## Not in scope
Anything not listed above. Other findings in the review belong to their own pass.
