# P1-07 — Cursor pagination API (`?before=<id>`) for channel and DM history

- **Unit Type:** Implementation
- **Phase:** 1 — "Cursor pagination"
- **State:** REVIEW (PR open)
- **Effort:** S
- **Depends on:** none (soft: P1-01's `idx_messages_channel` / `idx_dm_pair` make it fast)
- **Serialize with:** P1-02..P1-05. It edits two small handler blocks. If it runs before the split, edit the inline handlers in `server.js` and the split carries them along. Don't run it *concurrently* with a split unit.
- **Requirement Source:** IMPROVEMENT-PLAN.md Phase 1 ("Today you can only ever see the last 50")

## Current state (revalidated)
- `GET /spaces/:s/channels/:c/messages` supports `limit` (1-200), `offset` and `after`. `GET /dms/:u/messages` supports `limit` and `after`.
- `api.getMessages` sends `offset=0`. Nothing loads older messages.

## Scope
- db: `getMessagesBefore(space, channel, beforeId, limit)` and `getDmMessagesBefore(userId, otherId, beforeId, limit)`. Both use `WHERE m.id < ? ORDER BY m.id DESC LIMIT ?` and return oldest-first, with reactions and attachments hydrated the same way as `getMessages`.
- Routes: `?before=<id>` takes precedence over `offset`. Precedence is `after` > `before` > `offset`. Clamp with `intParam`. The response stays a plain array. The client infers `hasMore = rows.length === limit`.
- Keep `offset` working for back-compat.

## Acceptance criteria
- [x] New `server/tests/pagination.test.js`, seeded with 120 messages:
  - [x] `?limit=50` returns ids 71-120.
  - [x] `?before=71&limit=50` returns 21-70.
  - [x] `?before=21&limit=50` returns 1-20.
  - [x] Garbage `before=abc` is treated as absent.
- [x] The same three cases pass for DMs.
- [x] Private-channel gating still applies to `before` (403 for non-viewers).
- [x] `api.test.js` passes.

## Expected Areas of Change
- `server/db/index.js`: +2 functions and exports
- `server/server.js` lines ~687-695 and ~895-902 (or `routes/social.js` and `routes/spaces.js` if the split has landed)
- New `server/tests/pagination.test.js`

## Working Set / Blast Radius
Small: two handlers and two queries. Client unaffected until P1-08.

## Activation
- Activated 2026-10-15 on branch `claude/p1-07-cursor-pagination`, cut from main @ 739862f (server split complete).
- Baseline: 29/29 server tests passing (2 suites).

## Verification (AC → evidence)
| AC | Evidence |
|---|---|
| New `pagination.test.js` with 120 seeded messages | Written first. 5 of 10 failed before the change (every `before` case) and all 10 pass after. Seeding goes straight through `db`, so the ids are exactly 1-120. |
| Channel: latest → 71-120; `before=71` → 21-70; `before=21` → 1-20; `before=abc` ignored | `channel history` tests. |
| Same for DMs | `DM history` tests. |
| Private-channel gating applies to `before` | A member asking `secret` (view = admin) with `?before=200` gets 403. |
| `api.test.js` passes | Full run: 3 suites, 39/39. ESLint `no-undef` / `no-unused-vars` on `routes/` and `db/`: clean. |
| (extra) precedence | `before` + `offset` → `before` wins (66-70). `after` + `before` → `after` wins (116-120). |

## Notes
- Responses stay plain arrays (oldest-first). The client should treat `rows.length === limit` as "there may be more" (P1-08).
- There is still no index on `messages(channel_id, id)` / `dm_messages(user_a, user_b, id)`, so these are scans. That is fine at friends-server scale; P1-01 adds the indexes.
