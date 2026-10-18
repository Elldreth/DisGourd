# P3-20c — Hide preview

- **Unit Type:** Implementation (child of P3-20)
- **Phase:** 3
- **State:** COMPLETE (merged #131)
- **Effort:** S–M
- **Depends on:** none. Branched from P3-20b (#130) only to keep INDEX.md conflict-free; merge after it.
- **Serialize with:** `server/db/migrations.js`, `server/linkPreviews.js`, `server/routes/spaces.js`, `server/routes/social.js`, `Embed.jsx`, `MessageList.jsx`

## Why
P4-05 note: link cards can be noisy, and only deleting the whole message removed them.

## Scope
- **Migration v15:** `messages.embeds_hidden` and `dm_messages.embeds_hidden`.
- **Hiding is for good:** `db.hideEmbeds(kind, id)` clears the cards and sets the flag, and `linkPreviews.handleMessage` skips flagged messages, so an edit doesn't bring them back.
- **Routes:**
  - `DELETE /spaces/:s/channels/:c/messages/:id/preview`: the author, or anyone who may delete the message (`canModerateMessage`). Every viewer gets `message_embeds` with an empty list.
  - `DELETE /dms/:user/messages/:id/preview`: the author only. Both people get `dm_embeds` with an empty list.
  - The message must belong to that channel or conversation (404 otherwise).
- **App:**
  - A small × on each card ("Remove preview"). It shows on hover or focus, and always on touch screens.
  - It's offered on your own messages, and in channels also on messages you may moderate.
  - Channels, threads and DMs all wire it up. The existing `message_embeds` / `dm_embeds` handlers drop the cards for everyone.

## Acceptance criteria
- [x] Server: the author removes cards in a channel and every viewer is told; history has none; another member is refused; a moderator may; another channel's path and unknown ids are 404; an edit doesn't bring them back; DMs: the author may, the partner is refused, a stranger gets 404, and both people are told.
- [x] Web: no × without `onHide`, and the × calls it; in a channel it shows on your own messages and on those you may moderate, not others; in DMs only on your own.
- [x] All suites pass; `vite build` is clean.
- [x] Sandbox: the author removes a card and another member's open tab drops it.

## Evidence (2026-10-18)
| Acceptance criterion | Evidence |
|---|---|
| Server | `hide-preview.test.js` (4): channel: one card in history; another member 403; the author `{ ok: true }`; the viewer's `message_embeds` has `embeds: []`; history empty; flagged. A moderator (owner) removes a member's card; an outsider 403; another channel's path 404; unknown id 404. A flagged message edited with a URL: `deliver` is never called and no cards return. DMs: the partner 403, a stranger 404, the author ok; both get `{ type: 'dm_embeds', id, embeds: [] }` |
| Web | `HidePreview.test.jsx` (3): Embed without `onHide` has no button, with it the click calls it; a channel MessageList shows × on sandy's own message and bob's (moderatable), not cara's, and the click passes the message; a DM list shows it on your own only |
| Suites | Server: 36 suites, 320 tests. Web: 72 files, 602 tests. `vite build` clean |
| Sandbox | Tx Check #general, sandy's "preview test https://github.com/…" with a GitHub card. Bob's tab: the card and no ×. Sandy (author) clicked "Remove preview"; bob's open tab dropped the card (0 cards), with the message text and link kept |
