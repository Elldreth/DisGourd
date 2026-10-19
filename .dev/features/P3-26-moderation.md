# P3-26 — Moderation tools (Container: a–d)

- **Unit Type:** Container (not implemented directly)
- **Phase:** 3
- **State:** PLANNED
- **Effort:** L in total: a M, b M, c M, d S–M
- **Depends on:** P2-21 (roles and permissions), P1-10 (message moderation)
- **Requirement Source:** the user, 2026-10-18 ("moderation tools"). Design agreed with the user on 2026-10-19:
  - **Tools:** ban, timeout, a moderation log, and slow mode. Reports were not chosen (possible later).
  - **Permissions:** two new role permissions, "Ban members" and "Time out members", given to Admin by default. As with kick, you can only act on people ranked below you, never the owner.
  - **The person's view:** a clear notice. Timed out: the message box says "You're timed out in this server until 4:30 PM" (plus the reason). Banned: the server disappears with "You were banned from X" (plus the reason).
  - **Slow mode:** per channel in channel settings (Off / 5 s / 30 s / 1 min / 5 min); moderators exempt; the message box shows a countdown.

## Today (main at #149)
- **Delete others' messages:** `delete_others_messages`, rank-checked (P1-10).
- **Kick:** `kick` → `DELETE /spaces/:s/members/:user` and `members_changed`. Someone kicked can rejoin with any invite.
- **Roles:** P2-21, with `DEFAULT_PERMISSIONS` thresholds and named role permissions.
- **Not yet:** bans, timeouts, a log, slow mode.

## Children (one PR each, in order: the log first, so b–d write into it)
| Unit | What | Working set |
|---|---|---|
| P3-26a | Moderation log: `mod_log` table; entries for message deletes by others, kicks, role grants / removals, channel access changes (and later bans, timeouts, slow mode); a "Moderation log" screen in the server menu for moderators, newest first, with filters (action, person) and paging | migrations, db, routes/spaces.js + roles.js (writes), new route, ModLogDialog, ChannelList menu |
| P3-26b | Ban: the `ban_members` permission (Admin by default); ban with reason and "delete their messages from the last hour / day / week / none"; banned people are removed and refused by every invite; a Bans list to unban; their open sessions get `banned` (the server disappears with the notice) | migrations (bans), db, routes (ban / unban / list, invites join check), gateway notice, member menu, BansDialog, App notice |
| P3-26c | Timeout: the `timeout_members` permission (Admin by default); 5 min / 1 h / 1 day / 1 week with reason, and remove timeout; while timed out: no posting, reacting, threads, /imagine or speaking in voice (they can read and listen); it lifts by itself; a ⏱ on their name; the composer notice with the end time | migrations (space_members.timeout_until, reason), db, permission checks in the chat / reactions / imagine / voice paths, member menu, Composer notice |
| P3-26d | Slow mode: `channels.slowmode_seconds`; set in channel settings; the server refuses a post before the wait is up (`SLOWMODE`, with seconds left); moderators (delete_others_messages) exempt; the composer counts down; changes go in the log | migrations, routes (channel PATCH), chat gateway check, ChannelSettingsDialog, Composer |

## Decisions to keep
- **Rank:** every action follows kick's rule: only people ranked strictly below you, never the owner; a target who's above you is refused with 403.
- **Log entries** record: who acted, on whom (user id + name at the time), the action, the reason, extra details (duration, channel, message excerpt up to 100 characters for deletes), and the time. They're kept until the server is deleted. Viewing them needs any of ban_members, timeout_members, kick, delete_others_messages or manage_roles.
- **Bans** are per server and per account (no IP bans). A banned user can't see the server, isn't a member, and gets 403 "You're banned from this server" from any invite. Unbanning doesn't re-add them; they can rejoin with an invite.
- **Timeouts** are stored as an end time, so they need no background job; every check compares against now. The owner can't be timed out.
