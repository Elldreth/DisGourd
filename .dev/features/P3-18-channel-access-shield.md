# P3-18 — Channel list shield follows the role overrides

- **Unit Type:** Implementation (display fix)
- **Phase:** 3
- **State:** COMPLETE (merged #125)
- **Effort:** S
- **Depends on:** P2-21c
- **Serialize with:** `server/db/index.js` (`getUserSpaces`), `web/src/components/ChannelList.jsx`

## Problem
The channel list shows a small shield on restricted channels. It decided this from the legacy tier columns (`view_role` / `post_role`, sent as `view` / `post` in `channelMeta`). Since P2-21c, access is set per role with overrides, so a channel made private in the Channel settings role table showed no shield, and a channel whose old tier columns said restricted could show one wrongly. Noticed while building /imagine (P2-20d).

## Scope
1. `getUserSpaces` adds `private` (@everyone's override denies view) and `readOnly` (@everyone may view but not post) to each `channelMeta` entry, read through a new `everyoneChannel(channelId)` on `resolveAccess`. Existing fields stay.
2. The channel list shows the shield from those flags, titled "Private" or "Read-only".

## Acceptance criteria
- [x] `private` / `readOnly` follow @everyone's override, for owners, admins and members alike.
- [x] The tier columns alone no longer make a channel look restricted.
- [x] The shield shows for private and read-only channels with a matching title, and not otherwise.
- [x] Server and web suites and `vite build` pass.

## Expected Areas of Change
`server/db/index.js`, `server/tests/roles-api.test.js`, `server/tests/api.test.js`, `web/src/components/ChannelList.jsx`, `web/src/components/ChannelList.access.test.jsx` (new).

## Working Set / Blast Radius
5 files. `channelMeta` gains two fields; nothing reads them besides the channel list.

## Evidence (2026-10-18)
| Acceptance criterion | Evidence |
|---|---|
| Flags follow overrides | `roles-api.test.js` "channelMeta marks private and read-only channels from the overrides": post deny → `readOnly`; view deny with an Admin allow → `private` for the owner and an admin, hidden from a member |
| Tier columns ignored | same test: `view_role = 3, post_role = 3` with no overrides → `private: false, readOnly: false` |
| Shield | `ChannelList.access.test.jsx`: "Private" / "Read-only" titles, none for plain channels or tier fields alone |
| Suites pass | Server: 32 suites, 302 tests. Web: 69 files, 585 tests (after merging main). `vite build` clean |

## Discovered Work
None.
