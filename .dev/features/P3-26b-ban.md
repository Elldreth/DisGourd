# P3-26b — Ban

- **Unit Type:** Implementation (child of P3-26)
- **Phase:** 3
- **State:** PLANNED (READY once P3-26a merges)
- **Effort:** M
- **Depends on:** P3-26a

## Scope
- **The `ban_members` permission** (Admin by default), shown in the Roles screen as "Ban members".
- **Migration:** `bans(space_id, user_id, actor_id, reason, created_at, PRIMARY KEY(space_id, user_id))`.
- **Routes:**
  - **`POST /spaces/:s/bans { user, reason?, deleteMessages: 'none' | 'hour' | 'day' | 'week' }`:** rank-checked as for kick. It removes membership, stores the ban, optionally deletes the user's messages in the server from that window (each viewer told as for deletes), and logs it. The user's sockets get `{ type: 'banned', space, reason }`, and members get `members_changed`.
  - **`GET /spaces/:s/bans`:** for ban_members holders.
  - **`DELETE /spaces/:s/bans/:user`:** unban, logged.
- **Joining:** invite join refuses a banned user with 403 "You're banned from this server".
- **App:**
  - **The member list:** a "Ban…" item in its context menu (where Kick is), opening a dialog with Reason and "Delete their messages from" (none / the last hour / day / week).
  - **"Bans"** in the server menu: the list with Unban.
  - **On `banned`:** the server leaves the rail and a notice shows "You were banned from X" (+ reason).

## Acceptance criteria
- [ ] Server: ban (rank rules, owner never), the message windows, the invite refused, unban, the log entries, the `banned` frame, and permission refusals.
- [ ] Web: the Ban dialog, the Bans list with Unban, the banned notice.
- [ ] Sandbox: sandy bans bob (with a window); bob's tab drops the server with the notice; bob's invite is refused; unban, and he can join again.
