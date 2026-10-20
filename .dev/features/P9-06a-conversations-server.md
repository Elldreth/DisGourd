# P9-06a — Conversations on the server

- **Unit Type:** Implementation (child of P9-06)
- **Phase:** 9
- **State:** READY (once the P9-06 plan merges)
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

## Acceptance criteria
- [ ] **Migration:** a seeded v29 DB with pairs, messages, read state, edits and embeds migrates. Conversation and message counts match, unread is the same before and after, and v30 is the latest version.
- [ ] **Server:** every existing DM test passes unchanged (the old paths). New tests cover the conversation-id paths and ops, participant checks (a stranger gets 404), frames carrying `conversation`, unread by conversation, and the orphan rules.
- [ ] **All suites pass.** The web suite passes untouched.
- [ ] **Sandbox:** after the restart, existing DMs, unread, edits, replies and typing behave as before.
