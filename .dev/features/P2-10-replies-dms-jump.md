# P2-10 — Replies in DMs + jump to an unloaded original

- **Unit Type:** Implementation (rank 6, slice 2)
- **Phase:** 2, rank 6
- **State:** COMPLETE
- **Effort:** S–M
- **Depends on:** P2-09, P1-08 (pagination), P1-13 (DM hook)
- **Requirement Source:** IMPROVEMENT-PLAN.md Phase 2 #6

## Scope
- `DM_SELECT` adds the same `replyTo` join. Gateway `dm` accepts `replyTo` only if that message is in the same conversation pair.
- Jump to unloaded: add `GET .../messages?around=<id>&limit=50` (channel and DM). It returns the 25 messages before and after the id, and 404 if the id isn't in this channel or conversation. The client replaces its window with that result, sets `hasMore` for both directions, scrolls and highlights. A "Jump to present" button appears until you return to the newest messages. **This adds downward pagination** (`after` already exists).

## Acceptance criteria
- [x] Server tests:
  - [x] DM replies, plus rejecting a cross-conversation `replyTo`
  - [x] `around` returns a window containing the id
  - [x] `around` for an id in another channel returns 404, and a private channel returns 403
- [x] Manual: clicking a quote whose original is 200 messages back loads that window, highlights it, and "Jump to present" returns to live.

## Expected Areas of Change
`server/db/index.js`, `server/gateway/dm.js`, `server/routes/{spaces,social}.js`, the client hooks, `MessageList.jsx`, `DmPanel.jsx`, `api.js`, and tests.

## Working Set / Blast Radius
~8 files.

## Evidence
Baseline: main at 8197eb5 (after #91). Branch `claude/p2-10-dm-replies`.

| Acceptance criterion | Evidence |
|---|---|
| Server: DM replies; a cross-conversation `replyTo` is rejected | `server/tests/dmRepliesAround.test.js`: a reply's quote reaches both people live and appears in history. Another conversation's DM, a non-existent id, `'x'` and `-5` all store `replyTo: null`. A deleted original shows `{ id, deleted: true }`. |
| `around` returns a window containing the id | Channel: 25 before and 25 after, oldest first (g35–g85 around g60), and shorter windows at the start and end. DM: d15–d65 around d40. |
| `around` for another channel's id is 404; a private channel is 403 | Another channel's id and an unknown id give 404. A member asking about an admins-only channel gets 403, while the owner gets 200. DM: another conversation's id, or someone else's conversation, gives 404. |
| Manual: a quote whose original is 200 back loads its window, highlights it, and Jump to present returns to live | Sandbox (Tx Check #history): original #641, 200 fillers, then a reply quoting it. With the newest 50 loaded (the original not among them), a real click on the quote loaded a 51-message window around #641 with the original in view, highlighted and focused, and the bar "You're viewing older messages · Jump to present". A live message sent meanwhile was **not** appended to the old window. A real click on Jump to present loaded the newest page (including that held-back message), at the bottom, with the bar gone. The next live message merged normally. |

Also: a live DM reply in the sandbox (R on bob's message, type, Enter) showed the quote "@bob checking the DM list". `after=` now takes a `limit` (default 200 is unchanged for reconnect resyncs).

Tests: server 202 (8 new). Web 415 (6 window-hook, 4 MessageList, 1 DmPanel). Build clean.

### Design notes
- `state/historyWindow.js` holds the jump/newer/present logic once for both hooks. `useHistoryPaging` gains `hasNewer` / `loadNewer` / `setNewer`.
- While a window is showing (`hasNewer`), live messages aren't merged and a reconnect doesn't reload. Both are picked up by loadNewer or Jump to present, so the transcript never has a gap. The list stops auto-following the bottom, offers "Load newer messages" (button plus a sentinel when scrolled down), and turns `hasNewer` off when a short page arrives.
- A quote whose original can't be loaded (deleted, or not in this conversation) shows "Couldn't load the original message."
