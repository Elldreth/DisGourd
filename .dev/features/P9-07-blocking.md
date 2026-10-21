# P9-07 — Blocking people

- **Unit Type:** Container (children: P9-07a, P9-07b)
- **Phase:** 9
- **State:** COMPLETE (P9-07a #198, P9-07b #199)
- **Effort:** M (migration v31)
- **Depends on:** P9-06 (group DMs), P9-01 (reports), the mentions and push paths

## Why
There's no way to stop someone from messaging you, or to stop seeing what they post, short of a moderator banning them from a server.

## Decisions (owner, 2026-10-20)
- **Private contact stops, both ways:**
  - While A has B blocked, B can't DM A or add A to a group, and A can't DM B or add B to a group either.
  - Their existing 1-to-1 stays readable but takes no new messages.
  - Groups they're both already in stay, with B's messages collapsed for A (below).
- **In shared servers and groups:**
  - B's messages show to A as **"Blocked message · Show"**; Show reveals that one.
  - B's @mentions don't ping, badge or push A, and replies to A don't notify.
  - B's typing isn't shown to A.
- **B isn't told.** Trying to DM A, or add A to a group, gives B a neutral **"You can't message this person"**. B still sees A's messages in shared servers.
- **Where to block or unblock (all four):**
  - the member list's actions menu;
  - a 1-to-1 DM's header;
  - a message's "…" menu, beside Report;
  - **Settings › My account › Blocked people** (the list, with Unblock).
  - Blocking always asks first; unblocking doesn't.
- **Not affected:** server membership, roles, moderation (a moderator can still act on a blocked person's reports), voice channels, reactions, presence, and search.

## What exists today (mapped 2026-10-20)
- **Nothing to build on:** there's no block table or block check anywhere.
- **Friends** exist on the server (`friends`, `friend_requests`, routes in `routes/social.js`), but the app has no friends screen. P9-06c's add-to-group rule accepts friends.
- **Where the checks go:**
  - DMs: `gateway/dm.js` (`dm`, `dm_group_create` / `add` via `peopleToAdd`).
  - Mentions: the channel message path stores `mentions` and pushes through `push.notifyIfAway`.
  - The member list actions are in `MemberList.jsx`; the message menu in `MessageActions.jsx`; DM headers in `DmPanel.jsx`; My account in the settings pages.

## Children
- **P9-07a — Blocking on the server:**
  - Migration v31 (`user_blocks`) and the block routes.
  - Enforced for DMs, groups and friend requests.
  - Mentions and pushes skipped; GET /me (or a new GET /blocks) lists yours.
  - A `blocks_changed` frame to your other tabs.
- **P9-07b — Blocking in the app:**
  - Block / Unblock in four places.
  - Collapsed messages with Show; no notifications from blocked people; typing hidden.
  - A blocked 1-to-1 shows a bar instead of the composer.
  - The Settings list.
