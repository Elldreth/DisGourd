# P9-01 — Message reports

- **Unit Type:** Implementation
- **Phase:** 9
- **State:** READY
- **Effort:** M (migration v26)
- **Depends on:** P3-26 (moderation: log, ban, timeout), P1-10 (deleting others' messages)
- **Requirement Source:** the owner, 2026-10-20 ("message reports", the piece of moderation left out of P3-26). Design agreed on 2026-10-20:
  - **Who handles them:** moderators, meaning anyone with "Delete others' messages" (Admin by default) plus the owner. No new permission.
  - **Where:** a Reports queue in the server menu, with a count badge.
  - **Reporter shown:** yes, moderators see who reported; the reported person never does.
  - **DMs:** servers only for now. There is **no block feature** yet, despite what the question said; blocking users is noted as a possible future feature.

## Scope
- **Migration v26:** `reports(id, space_id → spaces CASCADE, message_id → messages ON DELETE SET NULL, channel, author_id, author_name, reporter_id, reason, note, excerpt, status 'open' | 'resolved' | 'dismissed', resolved_by, resolution, created_at, resolved_at)`.
  - The excerpt (up to 300 characters) and the author's name are copied at report time, so a report still reads right after the message is deleted.
- **`POST /spaces/:s/channels/:c/messages/:id/report { reason, note? }`:** for anyone who can view the channel.
  - The reasons are spam, harassment, inappropriate and other; the note is up to 300 characters.
  - You can't report your own message, or a bot's.
  - You can only have one open report per message; a repeat answers 200 with `{ already: true }`.
  - Moderators get `reports_changed { space, open }`.
- **`GET /spaces/:s/reports?status=open|closed&before=`:** moderators only.
  - Returns the newest first, 50 at a time. Each report has the reporter, the author, the channel, the excerpt, whether the message still exists, the reason, the note and the time.
  - **GET /spaces** gives moderators `openReports` (a count) for the badge.
- **`POST /spaces/:s/reports/:id/resolve { action: 'dismiss' | 'resolved' }`:** moderators only. It closes the report and every other open report on the same message, is logged in the moderation log (`report_dismiss` / `report_resolve`, with the excerpt), and sends `reports_changed`.
  - The queue's action buttons (Delete message, Time out, Ban) call the existing routes and gateway ops first, then resolve.
- **App:**
  - **The message menu:** "Report…" (not on your own messages) opens a dialog with the reason chips, an optional note, and "Report". A toast confirms: "Thanks — the moderators will take a look."
  - **The server menu:** "Reports" for moderators, with a red count badge when any are open. The badge also shows on the server's icon in the rail.
  - **The Reports dialog:** "Open" and "Closed" tabs. Each report shows the author, #channel and time, the excerpt (or "This message was deleted"), the reason, the note and who reported it. "Jump to message" opens it in context.
  - **The actions:** Delete message, Time out… (the P3-26c dialog), Ban… (the P3-26b dialog), Mark handled and Dismiss. Each one follows the rank rules, so buttons you can't use are hidden.
- **Not in scope:** DM reports, reporting a user rather than a message, notifying the reporter of the outcome, and blocking.

## Acceptance criteria
- [ ] Server: report (viewers only; not your own or a bot's; a duplicate open report is a no-op), the moderators-only list and count, resolving and dismissing (all open reports on that message close, logged, frame sent), a deleted message still listed with its excerpt, and refusals for non-moderators.
- [ ] Web: Report… and its dialog; the queue with the badge, tabs and actions (rank rules respected); Jump to message; live updates.
- [ ] All suites pass; `vite build` is clean.
- [ ] Sandbox: bob reports cara's message; sandy sees the badge, opens Reports, deletes the message from there, and the report moves to Closed and into the log.
