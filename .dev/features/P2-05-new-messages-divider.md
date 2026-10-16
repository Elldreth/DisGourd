# P2-05 — "New messages" divider + jump-to-unread

- **Unit Type:** Implementation
- **Phase:** 2, rank 3
- **State:** REVIEW (PR open)
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
- [x] Server test (new file `server/tests/unread-divider.test.js`): `unread` frame rows include `lastReadId` matching the last `read` op.
- [x] Manual: with 3 unread in #a, opening #a shows the divider above the 3rd-to-last message. With 120 unread, the jump bar appears; Jump pages back and lands on the divider.
- [x] Your own messages never create a divider. Re-opening a channel you already read shows no divider.

## Expected Areas of Change
`server/db/index.js`, `web/src/state/useChannelMessages.js`, `web/src/components/MessageList.jsx`, `web/src/components/ChatPanel.jsx`, and the new server test.

## Working Set / Blast Radius
~5 files.

## Evidence
| Check | Result |
|---|---|
| `server/tests/unread-divider.test.js` (2): unread rows carry `lastReadId` equal to the last `read` op; a never-read channel reports 0 | pass (failed first, before the db change) |
| `newMessages.test.js` (6): divider goes before the first new message, skips your own, none when nothing new, "not loaded yet" when all loaded messages are new and older history exists, start of channel | pass |
| `useChannelMessages.newMessages.test.js` (2): opening a channel captures `{ since, count }` before sending `read`; re-opening a read channel gives none; a channel with nothing unread at connect takes `since` from the first live message | pass |
| `MessageList.test.jsx` (5): divider placement; none without newMessages or for own messages only; Jump pages back until the divider loads and scrolls to it; Mark as read and Esc hide the bar; gives up after 10 pages with a note | pass |
| Full suites | web 111/111, server 74/74, `vite build` ok |
| Sandbox: bob posts 3 in #general while sandy is in #history; opening #general shows NEW right above "general new 1" (3rd-to-last), no bar | pass |
| Sandbox: 120 unread in #random; bar "120 new messages · Jump · Mark as read"; Jump paged back and centred the divider between the old and new batch; bar hid itself. Done after a page reload, so the connect-time `lastReadId` path is covered | pass |
| Sandbox: re-opening #general and #random afterwards shows no divider; no console errors | pass |

## Implementation notes
- `lastRead` (per channel) is kept in a ref: from the connect frame, from every `read` we send, and, for a channel the frame didn't list (nothing unread), from the first live message (`id - 1`). Message ids are global, so `id - 1` is a safe "read up to" mark.
- The divider is captured once per visit (first history load), so a reconnect reload doesn't move it; switching channels clears it.
- The first Jump in the sandbox scrolled the divider to the very top, where the sticky bar covered it, so the bar stayed. Now it scrolls the divider to the centre, like jumping to a reply's original.
- The bar's "since 14:02" time shows only once the first new message is loaded (before that we don't know its time).
- "Mark as read" only hides the bar: opening the channel already marks it read on the server.
- Tests were written alongside the code (the server test first), not strictly test-first.

## Not verified
- A race on page load: if the channel's history arrives before the gateway's `unread` frame, that first visit shows no divider. The frame is sent the moment the socket opens, so in practice it arrives first; not seen in testing.
- Touch / mobile layout of the bar was not checked.

## Discovered Work
- DMs have no divider (a non-goal here; a follow-up).
