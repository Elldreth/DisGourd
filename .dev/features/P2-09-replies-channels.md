# P2-09 — Replies/quotes in channels (end-to-end), jump to the loaded original

- **Unit Type:** Implementation (vertical slice 1 of rank 6; P2-10 is slice 2)
- **Phase:** 2, rank 6
- **State:** PLANNED
- **Effort:** M
- **Depends on:** P1-01 (migrations), P1-05 (gateway/chat.js), P3-05 (Reply action in the MessageActions menu)
- **Serialize with:** db/index.js, MessageList/MessageActions and Composer units
- **Requirement Source:** IMPROVEMENT-PLAN.md Phase 2 #6

## Scope
- Migration N: `ALTER TABLE messages ADD COLUMN reply_to INTEGER REFERENCES messages(id) ON DELETE SET NULL`. Same for `dm_messages`, so P2-10 doesn't need another migration.
- `MESSAGE_SELECT` adds a `LEFT JOIN messages p ON p.id = m.reply_to` and returns `replyTo: { id, authorId, author, snippet }`. The snippet is the first 100 characters, or "Attachment". `replyTo` is null if the original was deleted (the client shows "Original message was deleted").
- Gateway `message` accepts an optional `replyTo` id. It's valid only if that message is in the *same* channel; otherwise it's ignored. The broadcast includes the `replyTo` object. A reply to me counts as a mention: the original's author gets a mention row, as Discord does by default.
- Client:
  - "Reply" in MessageActions sets `replyingTo` in the channel hook.
  - Composer shows a bar ("Replying to @x · ✕"); Esc cancels it.
  - MessageList renders a compact quote line above the reply. Clicking it scrolls to the original and highlights it for 2s if loaded. If not loaded, show a toast "Original is further up". The unloaded jump comes in P2-10.

## Acceptance criteria
- [ ] New `server/tests/replies.test.js` covers:
  - [ ] a reply stored and returned in history with `replyTo` populated
  - [ ] a cross-channel `replyTo` ignored
  - [ ] deleting the original gives `replyTo: null` and keeps the reply
  - [ ] the original author gets a mention count
  - [ ] a private-channel `replyTo` can't leak a snippet to a channel where the original isn't visible (it's same-channel only)
- [ ] Manual: reply flow, cancel with Esc, jump-and-highlight to a loaded original.
- [ ] `api.test.js` passes.

## Expected Areas of Change
`server/db/migrations.js`, `server/db/index.js`, `server/gateway/chat.js`, `web/src/state/useChannelMessages.js`, `web/src/components/{Composer,MessageList,MessageActions,ChatPanel}.jsx`, and the new test.

## Working Set / Blast Radius
~9 files, which is near the budget. Server and client are each coherent. If it runs long, split at the server/client boundary (server first, since its tests stand alone).
