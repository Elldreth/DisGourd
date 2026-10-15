# P1-11 — Fix: DM unread badges lost on (re)connect (`dm_unread` key mismatch)

- **Unit Type:** Implementation (bug fix found during revalidation, not in IMPROVEMENT-PLAN.md)
- **Phase:** 1
- **State:** REVIEW (PR open)
- **Effort:** S (minutes)
- **Depends on:** none
- **Serialize with:** App.jsx units. Land this *before* P1-12.
- **Requirement Source:** found while revalidating on 2026-10-15

## Bug
- `server.js:1544` sends `{ type: 'dm_unread', counts: db.getDmUnreadCounts(id) }`, where each row is `{ other, count }` (`db/index.js:822`).
- `App.jsx:315-318` builds `map[c.with] = c.count`, so every count lands under the key `undefined`. After a page load or reconnect, DM unread badges show 0 until a new live DM arrives.

## Fix (preferred: server-side, so it can be tested)
Map the frame to `{ with: c.other, count: c.count }` in the gateway connect handler. That matches the `with` naming the other DM ops use. `GET /dms` is unchanged (it uses `other` internally).
Alternative (client-only): `map[c.with ?? c.other]`. Use this if the server file is mid-split.

## Acceptance criteria
- [x] New assertion in a new test file `server/tests/dm-unread.test.js`: B sends A two DMs while A is offline, and A's connect frames include `dm_unread` with `counts: [{ with: 'B', count: 2 }]`.
- [x] Manual: reload the page with unread DMs, and the DM rail badge plus per-conversation badges show the right counts.

## Expected Areas of Change
`server/server.js` (1 line, or `gateway/index.js` after P1-05), plus the new test file.

## Working Set / Blast Radius
Minimal.

## Activation
- Activated 2026-10-15 on branch `claude/p1-11-dm-unread`.
- Baseline: main @ 935fd85; 28/28 server tests passing.

## Verification (AC → evidence)
| AC | Evidence |
|---|---|
| `dm_unread` keyed by `with` | `server/tests/dm-unread.test.js` failed before the fix (`other` key), passes after. Full suite: 2 suites, 29/29 passing. |
| Badges correct after reload | Sandbox server with its own temp DB: bob sent sandy 2 DMs while she was offline. After sign-in and a page reload, the DM rail button showed **2** and the bob conversation showed **2**. |

## Diff Gate
The fix touches only `server/server.js`: the `dm_unread` frame on connect. The other change is the new test file. No client change was needed.
