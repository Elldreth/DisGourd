# P9-06a — Conversations on the server

- **Unit Type:** Implementation (child of P9-06)
- **Phase:** 9
- **State:** COMPLETE (#191)
- **Starting baseline:** main at 90b6794 (#190 merged)
- **Effort:** M–L (migration v30)
- **Depends on:** the P9-06 design

## Scope
No visible change. Today's DMs keep working through the old username paths while the server moves to conversation ids.

- **Migration v30:**
  - `dm_conversations (id, kind 'pair'|'group', name NULL, owner_id NULL, created_at)`.
  - `dm_participants (conversation_id, user_id, joined_at, muted 0|1, last_read_id)`, with the primary key `(conversation_id, user_id)` and an index on `user_id`.
  - `dm_messages.conversation_id`, with an index `(conversation_id, id)`, and `dm_messages.kind TEXT NULL` (`'system'` for P9-06c's notices; unused until then).
  - **Backfill:** one `pair` conversation per distinct `(user_a, user_b)` and its two participants. Each message gets its conversation, and `last_read_id` comes from `dm_read_state`.
  - `user_a` and `user_b` stay for now (written for pairs, unused for reads), so the migration is safe and P9-06c doesn't need a second one. The old table and index are dropped in a later cleanup, not here.
  - Must run cleanly on a copy of a real-sized DB. The sandbox DB counts as one; check the message and conversation counts match.
- **`db/index.js`:**
  - `getOrCreatePair(a, b)`, `getConversation(id)`, `participantsOf(id)` and `isParticipant(id, userId)`.
  - `storeDm(conversationId, authorId, …)`.
  - `getDmMessages…(conversationId)`: the Before, After, Around and ReplyTarget variants.
  - `getDmConversations(userId)` returns `[{ id, kind, name, members: [{ id, username, avatar }], lastMessageAt, unread }]`. For pairs it also has `username` and `avatar` of the other person, so today's app still works.
  - `markDmRead(userId, conversationId, lastId)` and per-conversation unread counts.
  - Search returns `conversationId` beside `dmWith`.
  - **Orphan cleanup:** a gone user is removed from their conversations. A pair's history goes only when both are gone; a group's when it has no members left.
- **Routes and gateway (`social.js`, `gateway/dm.js`):**
  - **New paths:** `GET /dms/c/:id/messages`, `…/messages/:mid/versions` and `DELETE …/messages/:mid/preview`. Each checks that you're a participant.
  - **The old `/dms/:username/…`** paths resolve to the pair conversation and keep working.
  - **Gateway ops** take `conversation` or the old `to` / `with`: `dm`, `dm_focus`, `dm_typing` and `dm_read`. `dm_edit` and `dm_delete` find the conversation from the message.
  - **Frames** (`dm`, `dm_update`, `dm_delete`, `dm_embeds`, `dm_typing`) add `conversation`, and go to every participant instead of `a` / `b`.
  - `dm_unread` adds `conversation` to each count. `dm_focus` stores the conversation id; typing goes to participants focused on it.
- **Push:** `data` gains `conversation`. The tag stays `dm:<name>` for pairs until P9-06b.

## As built
- **Migration v30:**
  - `dm_conversations` also has `pair_key` ("a:b", smaller id first, UNIQUE), so finding a pair is one lookup.
  - Indexes: `idx_dm_participants_user` and `idx_dm_conversation`.
  - The backfill is plain SQL in the migration's transaction.
  - `dm_read_state` stays, unread. `user_a` and `user_b` stay because they're NOT NULL with a user foreign key: pairs keep writing them, and a group message will put its author in both (P9-06c).
- **`db/index.js`:**
  - Conversation functions: `findPair`, `getOrCreatePair` (a transaction), `getConversation`, `participantsOf` / `participantIds`, `isParticipant`, `pairPartner`, `storeConversationDm`, `getConversationMessages` (plus Before, After, Around, ReplyTarget) and `markConversationRead`.
  - The old pair functions (`storeDm(from, to)`, `getDmMessages(user, other)`, `markDmRead`…) resolve the pair and call these, so existing callers and tests are unchanged.
  - `getDmById` adds `conversationId` and `kind`.
  - `editDm` and `deleteDm` ignore `kind = 'system'` messages.
  - `getDmConversations` returns the new shape, with unread in it; GET /dms no longer merges unread itself.
  - `getDmUnreadCounts` returns `{ conversation, count, other }`.
  - Search: by participation, `conversationId`, and `dmWith` for pairs.
- **Orphan cleanup:** participants of gone users are removed; then conversations with nobody left, and their messages.
- **`social.js`:**
  - One handler resolves `/dms/c/:id/…` (participant check, else 404) or `/dms/:username/…` (our pair; null if we've never talked, which gives `[]` as before).
  - The handler then serves `messages` (latest, before, after, around), `…/versions` and `DELETE …/preview` for both forms.
- **`gateway/dm.js`:**
  - `conversationFor(msg)` takes `conversation`, or `to` / `with` (the pair; created on a first `dm`).
  - Frames go to every participant through `sendToConversation` and carry `conversation`. `dm` keeps `to` / `toId` for pairs.
  - Pushes go to each other participant who isn't muted.
  - `dm_focus` stores `ws.dmConversation` as well as the old username. Typing reaches tabs focused on the conversation, or (for pairs) on the sender's name, including a pair that has no messages yet.
- **`gateway/index.js`:** `dm_unread` counts are `{ conversation, with, count }`.

## Acceptance criteria
- [x] **Migration:** a seeded v29 DB with pairs, messages, read state, edits and embeds migrates. Conversation and message counts match, unread is the same before and after, and v30 is the latest version.
- [x] **Server:** every existing DM test passes unchanged (the old paths). New tests cover the conversation-id paths and ops, participant checks (a stranger gets 404), frames carrying `conversation`, unread by conversation, and the orphan rules.
- [x] **All suites pass.** The web suite passes untouched.
- [x] **Sandbox:** after the restart, existing DMs, unread, edits, replies and typing behave as before.

## Evidence (2026-10-20)
| Acceptance criterion | Evidence |
|---|---|
| Migration | `db-migrations.test.js` (+1): a v29 DB seeded the old way (three users; pairs ann/ben with 3 messages, ann/cy 1, ben/cy 1; ann's read state up to her second message; one edit version). After `runMigrations`: v30; three `pair` conversations with the right `pair_key` and earliest `created_at`; no message without a conversation; counts 3/1/1; six participants with ann's `last_read_id` carried over; unread computed the new way equals the old way for every person (and is non-zero); the edit version kept; `kind` null. The index list now includes `idx_dm_conversation` and `idx_dm_participants_user` |
| Server | `dm-conversations.test.js` (new, 2 tests):<br>• A first `dm` by username creates the pair, one per pair either way round. Frames carry `conversation` plus `from` / `to` / `toId`; a stranger gets nothing. Bob replies by `conversation` with a reply quote. Cara can't post into it.<br>• GET /dms shape (members, `username`, `unread: 1`). History by id equals history by username, and before / after / around work. A stranger gets 404 by id or unknown id, and `[]` by username.<br>• Unread per conversation and `dm_unread` on connect; `dm_read` by conversation clears it.<br>• Typing via a conversation focus and via the old username focus; a non-member focusing doesn't get it.<br>• Edit, versions (404 for a stranger) and delete frames carry `conversation`. Search returns `conversationId` and `dmWith`, nothing for a stranger.<br>• Orphans: one person gone → they leave and the history stays; both gone → the conversation and its messages go.<br>**Two older tests** compare frames exactly and now include `conversation` (dm_unread counts; hide-preview's `dm_embeds`); every other existing DM test is untouched |
| All suites | Server 51 files, 450. Web 102 files, 801 (untouched) |
| Sandbox (:3005) | **The migration:** stopped the server and copied the v29 DB to `%TEMP%/disgourd-sandbox-pre-v30.db` (with WAL). Before: 139 DM messages, 2 pairs, unread `{ sandy: { bob: 1 } }`. After the restart: v30, 139 messages, 2 conversations, 0 unassigned, the same unread.<br>**The current app:** GET /dms shows both conversations (pairs, members, bob unread 1), and the rail says "Direct Messages, 1 unread". Opening bob's DM shows its history and the new-messages line.<br>**Live:** bob (script) focused and typed by conversation id → sandy's app showed "bob is typing", then his message sent by `conversation: 1`. Sandy replied from the app (old username ops) → bob's frames: sandy's `dm_typing` and `dm`, both with `conversation: 1`. Afterwards sandy has no unread, and bob has 1 (her reply) |
