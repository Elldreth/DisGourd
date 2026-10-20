# P9-07a — Blocking on the server

- **Unit Type:** Implementation (child of P9-07)
- **Phase:** 9
- **State:** READY (once the P9-07 plan merges)
- **Effort:** M (migration v31)
- **Depends on:** the P9-07 design

## Scope
- **Migration v31:** `user_blocks (blocker_id, blocked_id, created_at)`, primary key `(blocker_id, blocked_id)`, an index on `blocked_id`. Orphan cleanup drops rows for users who are gone.
- **`db`:** `blockUser`, `unblockUser`, `getBlocked(userId)` → `[{ id, username, avatar, since }]`, `isBlocked(blocker, blocked)`, and `eitherBlocked(a, b)`.
- **Routes:**
  - `GET /blocks` → my blocked list.
  - `PUT /blocks/:username` blocks; `DELETE /blocks/:username` unblocks.
  - Errors: yourself → 400; unknown username → 404.
  - Both block and unblock send `blocks_changed` to my sockets.
- **Enforcement (`eitherBlocked` blocks both ways):**
  - **DMs:** `dm` to a pair where either has blocked the other → refused with `{ type: 'error', op: 'dm', code: 'BLOCKED', error: "You can't message this person" }`. The same wording for both sides; it doesn't say who blocked whom.
  - **Groups:** `dm_group_create` / `dm_group_add` refuse anyone the adder has blocked or who has blocked the adder, with the same neutral message. Groups they're already both in are unaffected.
  - **Friend requests:** refused the same way (the server has them, the app doesn't show them yet).
  - **Mentions:** when B's channel message mentions A and A has blocked B, A gets no `mentions` row, no mention badge and no push. Thread replies too.
  - **DM pushes:** a group message from B sends A no push.
- **GET /dms** marks a pair as `blocked: true` when either side has blocked the other, so the app can show the bar.
- **Not changed:** history, search, presence, voice, reactions and moderation.

## Acceptance criteria
- [ ] **Server:**
  - Block and unblock (self 400, unknown 404, the list).
  - `blocks_changed` reaches my other tab.
  - DMs refused both ways with the neutral message, and the existing 1-to-1 is still readable.
  - Group create / add refused both ways.
  - A mention from a blocked person gives no mentions row and no push; others still do.
  - Group pushes skipped; GET /dms `blocked`.
  - After unblocking, everything works again.
- [ ] **All suites pass**, and the migration test lists the new table and index.
- [ ] **Sandbox:** sandy blocks bob. bob's DM gets the refusal; bob's @sandy in Tx Check doesn't add to sandy's mention badge; after unblocking, both work.
