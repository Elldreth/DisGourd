# P3-26b — Ban

- **Unit Type:** Implementation (child of P3-26)
- **Phase:** 3
- **State:** REVIEW
- **Starting baseline:** main at 4b14c78 (#152 merged)
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

## As built
- **Permission:** `ban_members` (default threshold 2, so new servers' Admin role has it). Migration v21 creates `bans` and adds `ban_members` to every existing seeded "Admin" role (other roles untouched). The Roles screen lists it as "Ban members".
- **Ban:** also drops the person's roles in that server. The reason is trimmed and capped at 200 characters. The delete window counts `created_at` (or the old `timestamp` for very old rows) and covers threads. The response is `{ ok, deleted }`; the log entry's details are `{ deleteMessages, deleted }`.
- **Invites:** the preview (GET) carries `banned`, and the Join dialog then says "You're banned from this server" and disables Join. A refused join doesn't use up the invite.
- **App:**
  - "Ban…" (red) under "Remove from server" in the member menu. The dialog shows the server's refusal and stays open.
  - "Bans" in the server menu (owner or `ban_members`).
  - The banned person gets a red top notice, "You were banned from X. Reason: …", which stays until dismissed (up to an hour).
  - The moderation log reads "ada banned bob and deleted 3 messages from the last day" / "ada unbanned bob", with Bans / Unbans filters.

## Acceptance criteria
- [x] Server: ban (rank rules, owner never), the message windows, the invite refused, unban, the log entries, the `banned` frame, and permission refusals.
- [x] Web: the Ban dialog, the Bans list with Unban, the banned notice. (The notice is checked live, not by a unit test.)
- [x] Sandbox: sandy bans bob (with a window); bob's tab drops the server with the notice; bob's invite is refused; unban, and he can join again.

## Evidence (2026-10-19)
| Acceptance criterion | Evidence |
|---|---|
| Server | `bans.test.js` (7): members get 403 and admins `{ bans: [] }`; refusals for yourself (400), another admin and the owner (403), an unknown user (404), and a bad window (400); a ban with "hour" removes the member, deletes the fresh message, keeps the two-hour-old one and another person's, sends `{ type: 'banned', space, reason: 'spamming links' }` (trimmed), and tells viewers `message_delete` and `members_changed`. It's logged as `ban`, and the list shows it `by: admin`. The invite preview has `banned: true`, the join is 403 "You're banned from this server", and the invite keeps `uses: 0`. "week" reaches a week back, "none" deletes 0. Unban: 403 for a member, 200, then 404; logged; the person isn't re-added, and an invite works again. With `ban_members` off for Admin → 403. `db-migrations.test.js`: v21 adds `ban_members` to an existing Admin role only. `roles-schema.test.js` now expects `ban_members` among Admin's defaults. Server suites: 39 files, 380 |
| Web | `Bans.test.jsx` (6): Ban… is hidden without the permission and for the owner above me, and shown for bob; the dialog sends `('bob', { reason: 'spam links', deleteMessages: 'day' })` and closes; a refusal shows in the dialog, which stays open; the Bans list shows "by ada" and the reason, and Unban calls `unbanMember('Tx', 'bob')` and drops the row; the empty list says "Nobody is banned."; the ban / unban log sentences. `CreateServerDialog.test.jsx`: a banned preview says so and disables Join. Web suites: 78 files, 661; `vite build` clean |
| Sandbox (:3005, restarted on this branch; sandy in one tab, bob in a second at 127.0.0.1) | Bob posted "FREE GOURDS, click my totally real link". Sandy → bob → Ban…, reason "Spam links in #general", "The last hour" → Ban. Bob's tab dropped Tx Check from the rail, with the red notice "You were banned from Tx Check. Reason: Spam links in #general". The spam message was deleted (`deleted: 1`); bob's older messages stayed. Bob's invite preview said `banned: true`, and joining gave 403 "You're banned from this server". Sandy → Bans showed "bob · by sandy · Today · Spam links in #general"; Unban → "Nobody is banned."; bob then joined with an invite (200). The log has `ban` (hour, 1 deleted) and `unban`. (Bob's sandbox "Mods" role, dropped by the ban, was given back afterwards.) |

## Discovered Work
- Someone who is in one of the server's voice channels when they're banned (or removed) stays connected until they leave; they can't join again. A fix would end their voice session on ban / kick. Not done here; it's the same for kick today.
