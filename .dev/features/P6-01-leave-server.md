# P6-01 — Leave server

- **Unit Type:** Implementation
- **Phase:** 6
- **State:** REVIEW (details confirmed by the owner, 2026-10-20)
- **Effort:** S
- **Depends on:** none
- **Serialize with:** P6-03 (`server/routes/spaces.js`, `web/src/state/useSpaces.js`, `web/src/api.js`)
- **Requirement Source:** `design/settings-review-2026-10/REVIEW.md` ("Members can't leave a server themselves"); P5-00 discovered work.

## Scope
- **Server:** `DELETE /spaces/:name/members/me`. Usernames must be at least 3 characters, so `me` can't clash with the kick route's `:username`. Any member except the owner may call it.
  - It removes the `space_members` row. `member_roles` goes with it through the FK cascade, the same as a kick.
  - It drops the user's own `read_state` rows for that server's channels, and their `thread_follows` for that server's threads.
  - It ends the user's voice session in that server (`voiceEject(..., 'left')`).
  - It sends `members_changed` to the members who remain, and `space_left` to all of the leaver's own sockets, so their other tabs move on too.
- **Owner:** gets 400 "The owner can't leave the server. Delete it or hand it over first." (handing a server over isn't built.)
- **Mod log:** no entry. The mod log records what moderators do to others; a member leaving is not a moderation action, and today it would need a new `leave` type in `ModLogSection`. *(Confirmed by the owner, 2026-10-20.)*
- **Client:**
  - A red "Leave server" item at the bottom of the server header menu, under a separator. It's shown only when you're not the owner.
  - It opens `ConfirmDialog` (danger): "Leave {server}? You won't be able to rejoin unless you get a new invite." Confirm label: "Leave server".
  - On success you move to your next server (`goToFirst`) or to the "No server" screen. The server is also removed from the saved rail order.

## Acceptance criteria
- [x] AC-1: a member who leaves is no longer in `GET /spaces/:name/members`. Their roles are gone, and `GET /spaces` no longer lists the server for them.
- [x] AC-2: the owner gets 400 and stays a member. A non-member gets the usual 403/404. Without a token the route returns 401.
- [x] AC-3: the remaining members get `members_changed`; every one of the leaver's sockets gets `space_left`.
- [x] AC-4: the leaver's `read_state` and `thread_follows` rows for that server are gone. Other users' rows are untouched.
- [x] AC-5: the menu shows "Leave server" (danger) to non-owners only. Cancelling does nothing; confirming calls the API and moves you to the next server, or to "No server" when it was your last.
- [x] AC-6: the server tests are in `server/tests/leave-server.test.js`, and a web test covers AC-5. The existing suites stay green.
- [x] AC-7: a sandbox check of leaving from the menu, with screenshots.

## Expected Areas of Change
`server/routes/spaces.js`, `server/db/index.js` (a `leaveSpace` helper in one transaction), `web/src/api.js`, `web/src/state/useSpaces.js`, `web/src/components/ChannelList.jsx` (menu item and dialog), plus tests.

## Working Set / Blast Radius
About 6 files. It reuses the kick path's broadcasts; nothing changes in the schema.

## Testing Strategy
Jest plus ws for the route and frames, Vitest plus Testing Library for the menu, and a sandbox run for the move-along.

## Out of Scope
Handing the server over to another owner, and rejoin cooldowns.

## Starting Baseline
Revision: `d7f159a` (main after #165).

## Implementation notes
- `db.leaveSpace` deletes the user's `read_state` rows for the server, their `thread_follows` for its channels, and the membership, in one transaction.
- The route ends a voice call first (`voice_ended` with reason `left`). The client now says "you left {server}" for that reason.
- After leaving, the client drops the server from the saved rail order and opens the server at the top of the rail, or the "No server" screen.

## Verification Evidence
| Acceptance Criterion | Status | Verification Type | Evidence |
|---|---|---|---|
| AC-1 | Verified | Jest `leave-server.test.js` | Gone from the member list and from the leaver's `GET /spaces`. Roles removed for the leaver only. |
| AC-2 | Verified | Jest | 401 without a token, 403 for a non-member (and for leaving twice), 400 for the owner, who stays a member. |
| AC-3 | Verified | Jest (two sockets for the leaver) | `members_changed` to the owner and the other member, and `space_left` on both of the leaver's sockets. No mod log entry. |
| AC-4 | Verified | Jest | The leaver's `read_state` and `thread_follows` rows are gone; the other member's are kept. |
| AC-5 | Verified | Vitest `LeaveServer.test.jsx` + sandbox | Members see the item last, in red; the owner doesn't (`design/p6-actions/shots/p6-01-owner-menu.jpg`, `p6-01-member-menu.jpg`). Cancel does nothing; confirm calls it once (`p6-01-confirm.jpg`). |
| AC-6 | Verified | Jest, Vitest, Vite | Server 43 suites / 405 tests, web 90 files / 726 tests, all green. `vite build` clean. |
| AC-7 | Verified | Sandbox (a copy of the sandbox DB on :3007, this branch's code) | bob left Tx Check and landed on Follow-up Check, with Tx Check gone from the rail (`p6-01-after-leave.jpg`). cara left her only server and got the "No server" screen (`p6-01-last-server.jpg`). No console errors. |
