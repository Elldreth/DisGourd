# P2-05 — "New messages" divider + jump-to-unread

- **Unit Type:** Implementation
- **Phase:** 2, rank 3
- **State:** PLANNED
- **Effort:** S–M
- **Depends on:** P1-08 (jump must be able to page back to the first unread)
- **Serialize with:** db/index.js units, MessageList.jsx units
- **Requirement Source:** IMPROVEMENT-PLAN.md Phase 2 #3

## Scope
- Server: `getUnreadCounts` also selects `COALESCE(rs.last_read_id, 0) AS lastReadId`, so the `unread` connect frame carries it. That's a db-only change; the frame code is unchanged.
- Client (channel hook):
  - Keep `lastRead[key]`. On channel open, *capture* `lastRead[key]` before sending `read`.
  - Keep it updated whenever we send `read`, using the max id we've seen. This prevents a stale divider on re-entry.
  - If no lastReadId is known (it wasn't in the frame because the channel had zero unread), don't show a divider.
- MessageList:
  - Render a pink "NEW" divider before the first message with `id > capturedLastRead` and `author !== me`.
  - When the divider is off-screen above, show a top bar: "N new messages since 14:02 · Jump · Mark as read". Jump calls `loadOlder()` until the divider message is loaded (cap: 10 pages; past that, show a toast) and then scrolls to it.
  - Esc or "Mark as read" dismisses the bar.
- The divider clears when you leave the channel.

## Non-goals
DMs (a follow-up). Unread state synced across devices in real time.

## Acceptance criteria
- [ ] Server test (new file `server/tests/unread-divider.test.js`): `unread` frame rows include `lastReadId` matching the last `read` op.
- [ ] Manual: with 3 unread in #a, opening #a shows the divider above the 3rd-to-last message. With 120 unread, the jump bar appears; Jump pages back and lands on the divider.
- [ ] Your own messages never create a divider. Re-opening a channel you already read shows no divider.

## Expected Areas of Change
`server/db/index.js`, `web/src/state/useChannelMessages.js`, `web/src/components/MessageList.jsx`, `web/src/components/ChatPanel.jsx`, and the new server test.

## Working Set / Blast Radius
~5 files.
