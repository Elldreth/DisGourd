# P2-09 — Replies/quotes in channels (end-to-end), jump to the loaded original

- **Unit Type:** Implementation (vertical slice 1 of rank 6; P2-10 is slice 2)
- **Phase:** 2, rank 6
- **State:** COMPLETE (merged in Elldreth/DisGourd#51)
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
- [x] New `server/tests/replies.test.js` covers:
  - [x] a reply stored and returned in history with `replyTo` populated
  - [x] a cross-channel `replyTo` ignored
  - [x] deleting the original gives `replyTo: null` and keeps the reply
  - [x] the original author gets a mention count
  - [x] a private-channel `replyTo` can't leak a snippet to a channel where the original isn't visible (it's same-channel only)
- [x] Manual: reply flow, cancel with Esc, jump-and-highlight to a loaded original.
- [x] `api.test.js` passes.

## Expected Areas of Change
`server/db/migrations.js`, `server/db/index.js`, `server/gateway/chat.js`, `web/src/state/useChannelMessages.js`, `web/src/components/{Composer,MessageList,MessageActions,ChatPanel}.jsx`, and the new test.

## Working Set / Blast Radius
~9 files, which is near the budget. Server and client are each coherent. If it runs long, split at the server/client boundary (server first, since its tests stand alone).

## Activation
- Activated 2026-10-15 on branch `claude/p2-09-replies`, cut from main @ 773da12.
- Baseline: 65/65 server tests passing (7 suites).

## Deviations from the packet (and why)
- **`reply_to` is a plain INTEGER, not an FK with `ON DELETE SET NULL`.** With SET NULL, a reply whose original was deleted would look exactly like a normal message, so the planned "Original message was deleted" notice would be impossible. With a plain id, history returns `replyTo: { id, deleted: true }` once the original is gone. The reply itself is always kept. Ids are AUTOINCREMENT, so they're never reused. The AC "deleting the original → replyTo null" is met in spirit (the reply is kept and nothing leaks) but returns the `deleted` marker instead of null.
- **There is no `web/src/state/useChannelMessages.js` yet** (it arrives with P1-12). The `replyingTo` state lives in `ChatPanel`, which owns both MessageList and Composer. `App.jsx` only forwards `replyTo` in `sendMessage`.
- **Extras:** the quote snippet hides `||spoilers||` as "(spoiler)". A **"Jump to original"** item is in the message menu, so keyboard users can jump too. The **R** key replies to the focused message. A `reply` icon was added to `Icon.jsx`. `db-migrations.test.js` now derives `LATEST_VERSION` instead of hard-coding 2.

## Verification (AC → evidence)
| AC | Evidence |
|---|---|
| Reply stored + in history with `replyTo` | `replies.test.js`. The live frame and the history row both carry `{ id, authorId, author, snippet }`, with the snippet capped at 100 chars. A non-reply returns `replyTo: null`. |
| Cross-channel `replyTo` ignored | A message from `#random` quoted in `#general` gives `replyTo: null`, and the message is still sent. |
| Private original can't leak | An owners-only `#secret` message quoted by a member in `#general` gives `replyTo: null`, and the text is absent from history. |
| Deleted original | The reply is kept and returns `replyTo: { id, deleted: true }` (see the deviation above). |
| Original author gets a mention | The frame's `mentions` is `['ana']`, and `getMentionCounts` shows 1 in `#random`. Replying to yourself gives no mention. |
| Garbage `replyTo` | `'abc'`, `{id:1}`, `-5` and `999999` are all sent with `replyTo: null`. |
| `api.test.js` / suite | 8 suites, 72/72. Jest exits cleanly without `--forceExit`. ESLint `db/` and `gateway/`: clean. |
| Manual: reply flow | Sandbox: hover, then Reply. The composer focuses, and the reply posts with the quote line "↳ @sandy smoke test after the server split". The row label reads "sandy, 01:53 AM, replying to sandy, replying from the UI". |
| Manual: Esc cancels | R on a focused row shows "Replying to @sandy" (screenshot) with the cursor in the composer. Esc removes the bar. |
| Manual: jump + highlight | Clicking the quote scrolls to and focuses the original, highlighted (screenshot). The highlight clears after 2s. With the original outside the loaded 50 (60 fillers seeded), the note "The original message is further up in the history." shows and clears after 3s. |
