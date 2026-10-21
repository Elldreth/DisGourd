# P9-07a — Blocking on the server

- **Unit Type:** Implementation (child of P9-07)
- **Phase:** 9
- **State:** REVIEW
- **Starting baseline:** main at cea0eaf (#197 merged)
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

## As built
- **Migration v31:** `user_blocks` and `idx_user_blocks_blocked`. Orphan cleanup drops rows for gone users.
- **`db`:** `blockUser`, `unblockUser`, `getBlocked`, `isBlocked`, `eitherBlocked`.
  - `addMentions(…, authorId)` skips anyone who has blocked the author: no row, no `mentionedIds` (so no push and no thread auto-follow), and their name isn't in the frame's `mentions`.
  - `getDmConversations` gives pairs `blocked`.
- **`routes/social.js`:**
  - `GET /blocks`, `PUT` / `DELETE /blocks/:username` (yourself → 400, unknown → 404, other methods → 405). Both block and unblock send `blocks_changed` to my sockets only.
  - `POST /friends/request` → 403 "You can't send this person a friend request" when either has blocked.
- **`gateway/dm.js`:**
  - `dm` refuses BLOCKED "You can't message this person", by `to` (checked before a pair is created) or for a pair's conversation.
  - `peopleToAdd` refuses BLOCKED "You can't add <name>", so a group can't be created with, or added to by, someone blocked either way.
  - Group pushes skip people who blocked the sender; `dm_typing` skips them too.
- **The refusal** uses the same words for both sides.

## Acceptance criteria
- [x] **Server:**
  - Block and unblock (self 400, unknown 404, the list).
  - `blocks_changed` reaches my other tab.
  - DMs refused both ways with the neutral message, and the existing 1-to-1 is still readable.
  - Group create / add refused both ways.
  - A mention from a blocked person gives no mentions row and no push; others still do.
  - Group pushes skipped; GET /dms `blocked`.
  - After unblocking, everything works again.
- [x] **All suites pass**, and the migration test lists the new table and index.
- [x] **Sandbox:** sandy blocks bob. bob's DM gets the refusal; bob's @sandy in Tx Check doesn't add to sandy's mention badge; after unblocking, both work.

## Evidence (2026-10-21)
| Acceptance criterion | Evidence |
|---|---|
| Server | `blocking.test.js` (new, 5):<br>• Self 400, unknown 404, block → `{ ok, blocked: true }`; ann's second tab gets `blocks_changed` and ben gets nothing; GET /blocks lists ben for ann and nothing for ben.<br>• DMs: ben by `to` and ann by `conversation` both get `{ code: 'BLOCKED', error: "You can't message this person" }`. The old 1-to-1 is still readable, GET /dms shows `blocked: true` for both, typing doesn't reach ann, and cyd's DM to ann works.<br>• Groups: ann can't create one with ben, nor ben with ann ("You can't add …"). cyd can; after ben leaves, ann can't add him back but cyd can. ben's typing reaches cyd, not ann. With both away and subscribed, ben's group message pushes to cyd only.<br>• Mentions: ben's "@ann and @cyd" stores cyd's mention only and pushes to cyd only. Friend requests are 403 both ways.<br>• After unblocking: a DM arrives, `blocked: false`, a mention row for ann, and the friend request is 201.<br>`db-migrations.test.js`: the new index; the v30 test now migrates to 30 explicitly |
| All suites | Server 53 files, 461. Web 103 files, 811: `web/devProxy.js` now lists `/blocks` (the dev-proxy test checks every top-level server route; the first CI run failed on it) |
| Sandbox (:3005, restarted to v31) | sandy blocks bob → `{ ok: true, blocked: true }`; sandy's socket gets `blocks_changed`, bob's doesn't; GET /blocks `["bob"]`. bob's DM → BLOCKED "You can't message this person" and sandy receives nothing; sandy's GET /dms shows bob `blocked: true`. bob's "@sandy and @cara" in Tx Check › general → mentions `["cara"]`. Unblock → bob's DM arrives, and "ping @sandy" → mentions `["sandy"]` |
