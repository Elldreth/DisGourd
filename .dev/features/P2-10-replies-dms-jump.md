# P2-10 — Replies in DMs + jump to an unloaded original

- **Unit Type:** Implementation (rank 6, slice 2)
- **Phase:** 2, rank 6
- **State:** PLANNED
- **Effort:** S–M
- **Depends on:** P2-09, P1-08 (pagination), P1-13 (DM hook)
- **Requirement Source:** IMPROVEMENT-PLAN.md Phase 2 #6

## Scope
- `DM_SELECT` adds the same `replyTo` join. Gateway `dm` accepts `replyTo` only if that message is in the same conversation pair.
- Jump to unloaded: add `GET .../messages?around=<id>&limit=50` (channel and DM). It returns the 25 messages before and after the id, and 404 if the id isn't in this channel or conversation. The client replaces its window with that result, sets `hasMore` for both directions, scrolls and highlights. A "Jump to present" button appears until you return to the newest messages. **This adds downward pagination** (`after` already exists).

## Acceptance criteria
- [ ] Server tests:
  - [ ] DM replies, plus rejecting a cross-conversation `replyTo`
  - [ ] `around` returns a window containing the id
  - [ ] `around` for an id in another channel returns 404, and a private channel returns 403
- [ ] Manual: clicking a quote whose original is 200 messages back loads that window, highlights it, and "Jump to present" returns to live.

## Expected Areas of Change
`server/db/index.js`, `server/gateway/dm.js`, `server/routes/{spaces,social}.js`, the client hooks, `MessageList.jsx`, `DmPanel.jsx`, `api.js`, and tests.

## Working Set / Blast Radius
~8 files.
