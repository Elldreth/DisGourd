# P10-01 — Reports: grouped cards, action hierarchy, nav count, quoted dialog, empty state, menu groups

- **Unit Type:** Implementation (child of P10-00)
- **Phase:** 10
- **State:** PLANNED
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
- [ ] AC-1: two reports on one message render as one card listing both reporters; handling it closes both and the card leaves.
- [ ] AC-2: at 375×812 each card's actions fit on one row; no horizontal scroll.
- [ ] AC-3: Act on ▾ hides actions the moderator can't use (same rank rules as today).
- [ ] AC-4: Server settings shows the open count next to Reports; it updates on `reports_changed`.
- [ ] AC-5: the Report dialog shows the message's text.
- [ ] AC-6: at 375×812, Server menu › Reports lands on the Reports page (test + sandbox).
- [ ] AC-7: axe clean on the Reports page and the Report dialog, in both themes.

## Expected Areas of Change
ReportsSection.jsx, ReportDialog.jsx, MessageList.jsx (menu), ServerSettingsDialog.jsx, SettingsLayout.jsx, tests.

## Not in scope
Anything not listed above. Other findings in the review belong to their own pass.
