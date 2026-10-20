# P9-01 — Message reports

- **Unit Type:** Implementation
- **Phase:** 9
- **State:** REVIEW
- **Starting baseline:** main at 1ab6766 (#176 merged)
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

## As built (changes from the plan noted)
- **Where it lives:** the settings round (P5-04) gave servers one **Server settings** window, so Reports is its own section there, under **Moderation**, first.
  - The server menu shows **Reports (n)** only while reports are open, which keeps the menu short (P5-04's rule); it opens the window at Reports.
  - The open count also shows as an amber number inside the corner of the server's rail icon. (A first try hanging off the corner was clipped by the round icon, so it moved inside.)
- **Confirming:** the dialog itself shows "Thanks — the moderators will take a look." instead of a toast.
- **Open / Closed** are toggle buttons (`aria-pressed`), not tabs, so they don't mix with the window's section tabs.
- **Delete message** from the queue is `POST …/resolve { action: 'delete' }`. Deleting was only a gateway op, so the server now deletes with the same rank check, tells viewers, and logs both `message_delete` and `report_resolve`.
- **Time out and Ban** call the existing routes through the P3-26 dialogs, then resolve with `resolution: 'timeout' | 'ban'`.
- **Jump to message** closes the window, opens the channel and scrolls to the message (a `jumpRequest` into ChatPanel). A report from a thread opens the thread.
- **The log** gains "sandy handled a report (spam) on cara's message in #general — message deleted" and "… dismissed 2 reports …", with Reports handled / Reports dismissed filters.
- **Tests:** `change-password.test.js` checked "the schema is version 25"; it now checks "at least 25".

## Acceptance criteria
- [x] Server: report (viewers only; not your own or a bot's; a duplicate open report is a no-op), the moderators-only list and count, resolving and dismissing (all open reports on that message close, logged, frame sent), a deleted message still listed with its excerpt, and refusals for non-moderators.
- [x] Web: Report… and its dialog; the queue with the badge, tabs and actions (rank rules respected); Jump to message; live updates.
- [x] All suites pass; `vite build` is clean.
- [x] Sandbox: bob reports cara's message; sandy sees the badge, opens Reports, deletes the message from there, and the report moves to Closed and into the log.

## Evidence (2026-10-20)
| Acceptance criterion | Evidence |
|---|---|
| Server | `reports.test.js` (7):<br>• **Refusals:** your own message, a bad reason, an unknown id, the wrong channel, an owner-only channel (404) and a non-member (403).<br>• **Filing:** a report reaches the moderators (`reports_changed { open: 1 }` to the admin, not to bob; `openReports` in GET /spaces for the admin only; the queue is 403 for bob). It's listed with the reporter, author, trimmed note and a 300-character excerpt, and a repeat gives `{ already: true }`.<br>• **Dismiss:** closes both open reports on a message (`closed: 2`), is logged with `reports: 2`, and a second resolve gives 409.<br>• **Delete from the queue:** removes the message (viewers get `message_delete`), is listed as resolved / deleted with the excerpt kept, and logs `message_delete` and `report_resolve`.<br>• **Rank:** an admin can't delete the owner's message from the queue (403); "resolved" keeps the label `timeout`.<br>• **Outliving the message:** a report on a deleted message stays, with `messageId: null`; a thread report carries `{ name, parentChannel, channel }`; the bot's message gets 400.<br>• **Server deleted:** its reports go.<br>Server suites: 48 files, 429 |
| Web | `Reports.test.jsx` (10):<br>• Report… is offered on others' messages, not your own or the bot's.<br>• **The dialog:** Report stays disabled until a reason is picked; it sends `{ reason: 'harassment', note: 'third time' }`, then thanks you; a refusal shows.<br>• **The section:** text and actions follow rank and permission (no Ban without it; a higher author leaves only Mark handled / Dismiss; a deleted message has no Delete); Delete and Dismiss call `resolveReport`; Time out… times them out, then resolves with `timeout`; Closed shows "Handled (message deleted) by ada" / "Dismissed by sandy"; an empty queue says so.<br>• **Rail:** "Tx, 3 open reports".<br>• **Menu:** Reports only with open reports, opening Server settings at Reports.<br>• **Log:** the sentences.<br>`ServerSettings` / `ModLogDialog` tests list the new section. Web suites: 100 files, 779; `vite build` clean |
| Sandbox (:3005, restarted on this branch; sandy and bob in two tabs) | Cara (script) posted "CHEAP GOURDS!!! DM me for wholesale prices, limited stock". Bob, in Tx Check: right-click → menu (Reply, Add reaction, Copy text, Pin message, Create thread, Report…) → Report… → Spam, "Third spam post today" → "Report sent". Sandy's rail (live, from another server): "Tx Check, 1 unread, 1 open report" with an amber 1. Server menu → "Reports 1" → Server settings › Moderation › Reports showed the report with all six actions (sandy is the owner). Jump to message closed the window and highlighted it in #general. Delete message: the message disappeared from bob's view; Closed shows "Handled (message deleted) by sandy"; the badge and the menu item went; Moderation log: "sandy handled a report (spam) on cara’s message in #general — message deleted" above the delete entry |
