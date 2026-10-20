# P9-06 — Group DMs

- **Unit Type:** Container (children: P9-06a–d)
- **Phase:** 9
- **State:** PLANNED
- **Effort:** L (migration v30)
- **Depends on:** P1-x DMs, P3-27 (DM edit history), P6 (DM panel)

## Why
DMs are strictly two people. People want a small private chat with a few friends without making a server.

## Decisions (owner, 2026-10-20)
- **Who can be added:** people you share a server with, or your friends. They join right away and can leave at any time.
- **How a group is run:**
  - Up to **10 people**.
  - Anyone in the group can **add** people and **rename** it, and anyone can **leave**.
  - Only the person who started it (the **owner**) can **remove** someone. If the owner leaves, ownership passes to whoever has been in longest.
  - A group with no name shows its members' names ("bob, cara, dee").
- **Adding someone to a 1-to-1 DM starts a new group** with all three. The 1-to-1 stays private, and the new person doesn't see its history.
- **Notifications:** every message counts as unread and can push, like DMs. Each group has a **Mute** switch: unread still shows, but there are no pushes or sounds.
- **Technical, mine:** DMs move to one **conversation** model. Today's DMs become 2-person conversations (one per pair, as now); groups are conversations with a name and an owner. Everything is keyed by a conversation id instead of the other person's username.

## What exists today (mapped 2026-10-20)
- **Database:**
  - `dm_messages` stores a sorted pair (`user_a`, `user_b`); `idx_dm_pair`.
  - `dm_read_state (user_id, other_id)`.
  - `dm_message_versions` and `dm_message_embeds` are keyed by message, so they need no change.
  - Orphan cleanup deletes a pair's history when either user is gone (`db/index.js:51`). That would be wrong for groups.
- **The wire format is keyed by the other person's username:**
  - REST `/dms/:username/messages…`.
  - Gateway `dm {to}`, `dm_edit`, `dm_delete`, `dm_focus {with}`, `dm_typing {with}` and `dm_read {with}`.
  - Frames `dm`, `dm_update`, `dm_delete`, `dm_embeds`, `dm_typing {from}` and `dm_unread {counts:[{with}]}`.
  - Push `data.dm` and the service worker's `dm:<name>` tag; search `dmWith`.
- **The app:**
  - `useDms` keys `current`, `unread`, `typing` and paging by username.
  - `DmSidebar` and `DmPanel` show one avatar and name; the switcher uses `d:<username>`.
  - The saved view state holds `{ dm: username }`, and `notify.js` compares the author with the open DM.
- **DMs have:** edits and history, deletes, replies, attachments, previews, search, typing and the "new" divider.
- **DMs don't have:** reactions, pins, threads, mentions, reports, /imagine or calls. Groups won't add these (out of scope; see Discovered Work in the children).
- **Who can DM whom:** anyone can DM any username; there's no block list.

## Children
- **P9-06a — Conversations on the server:**
  - Migration v30, conversation ids everywhere on the server, and the old username-based routes and ops still accepted.
  - No visible change.
- **P9-06b — Conversations in the app:**
  - The app switches to conversation ids, still 1-to-1 only.
  - No visible change.
- **P9-06c — Group DMs on the server:**
  - Create, add, remove, leave, rename and owner handover; the who-can-be-added rule; notices in the chat.
  - Sending to every member; typing; pushes with the group's name; Mute.
- **P9-06d — Group DMs in the app:**
  - New group; "Add people" from a 1-to-1 (makes a new group).
  - Group rows and header; a members dialog (add, remove, rename, leave); Mute.
