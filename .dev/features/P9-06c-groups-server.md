# P9-06c — Group DMs on the server

- **Unit Type:** Implementation (child of P9-06)
- **Phase:** 9
- **State:** READY (once P9-06b merges)
- **Effort:** M
- **Depends on:** P9-06a, P9-06b

## Scope
- **Gateway ops**, each answering with an error code where noted:
  - `dm_group_create { members: [usernames], name? }`: 2–9 others, so 3–10 people. You're the owner.
  - `dm_group_add { conversation, members }`: any member can add, up to 10 in total.
  - `dm_group_remove { conversation, member }`: owner only.
  - `dm_group_leave { conversation }`: anyone.
  - `dm_group_rename { conversation, name }`: any member; 1–50 characters, or empty for no name.
  - `dm_mute { conversation, muted }`: per person. It works on pairs too.
- **The add rule:** each person added must share a server with the adder or be their friend. Otherwise `NOT_ALLOWED`, which names them.
  - Pairs can't be added to. The app starts a new group instead (P9-06d).
- **The owner:** when the owner leaves, the member who joined earliest becomes owner. When the last member leaves, the group and its messages are deleted.
- **A removed or leaving member:**
  - Loses access at once: their sockets get `dm_left { conversation }` and later reads return 404.
  - Doesn't see later messages.
  - Their own old messages stay in the group.
- **Notices in the chat:** "sandy started the group", "sandy added bob and cara", "sandy removed dee", "dee left", "sandy named the group Gourd Club" and "bob is now the owner".
  - They're stored as messages with `kind: 'system'` (the column comes from P9-06a's v30).
  - They can't be edited, replied to or reported.
- **Frames:**
  - `dm_conversation { conversation }` (the whole summary: name, owner, members, muted) goes to every member on any change, and to added people.
  - Messages, typing and edits fan out to the current members only.
- **Pushes:** title is the group's name or member names; body "sandy: …". None for a member who muted the group, or while they're on DND.
- **GET /dms** gives `kind`, `name`, `ownerId`, `members` and `muted` for each conversation.
- **Search** covers group messages for members only.
- **The old username paths and ops** go away once the app no longer uses them (after P9-06b).

## Acceptance criteria
- [ ] **Server:**
  - Create: sizes, the add rule (shared server, friend, a stranger refused), and the owner.
  - Add, remove (owner only) and leave (ownership passes; last one out deletes the group).
  - Rename, and the system notices.
  - Fan-out only to current members; a removed member gets 404 and `dm_left`.
  - Mute stops pushes but not unread.
  - Search scope; GET /dms summaries; pairs can't be added to.
- [ ] **All suites pass.**
- [ ] **Sandbox:** sandy makes a group with bob and cara (gateway script). Messages reach both; cara leaves; sandy removes bob; it shows in the DB and frames.
