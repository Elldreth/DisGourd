# P9-06c — Group DMs on the server

- **Unit Type:** Implementation (child of P9-06)
- **Phase:** 9
- **State:** REVIEW
- **Starting baseline:** main at e5577d4 (#192 merged)
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

## As built
- **`db/index.js`:**
  - `canAddToGroup` (a shared server, or friends), `createGroup` (owner first by `joined_at`), `addParticipants`, `leaveConversation` (returns `{ gone }` or `{ newOwner }`; deletes the group and its messages when empty), `renameConversation`, `setConversationMuted` and `getConversationSummary`.
  - `storeConversationDm(…, kind)` writes notices.
  - DM reads carry `kind` only on notices (`hydrateDm`).
  - Reply targets skip notices; `editDm` / `deleteDm` already did.
  - `getDmConversations` can return one conversation (`only`).
- **`gateway/dm.js`:**
  - New ops: `dm_group_create` (also answers the creator with `dm_group_created { conversation }`), `dm_group_add`, `dm_group_remove`, `dm_group_leave`, `dm_group_rename` and `dm_mute`. All are registered in `router.js`.
  - Refusals are `{ type: 'error', op, code, error }` with codes BAD_REQUEST, NOT_FOUND, NOT_ALLOWED and TOO_MANY.
  - Names are trimmed, spaces collapsed, at most 50 characters.
  - Notices are `dm` frames with `kind: 'system'`.
  - Each member gets their own `dm_conversation`, which includes their Mute.
  - Group pushes are titled with the name (or the other members' names), with body "sandy: …".
- **Changed from the plan:** the old username-keyed DM paths and ops **stay**. A tab that hasn't reloaded since P9-06b still uses them (seen in the 06b sandbox check), and they only ever reach pairs. Drop them in a later cleanup if wanted.
- **Until P9-06d:** today's app lists a group as a row with "?" and no name. Groups can't be made from the app yet.

## Acceptance criteria
- [x] **Server:**
  - Create: sizes, the add rule (shared server, friend, a stranger refused), and the owner.
  - Add, remove (owner only) and leave (ownership passes; last one out deletes the group).
  - Rename, and the system notices.
  - Fan-out only to current members; a removed member gets 404 and `dm_left`.
  - Mute stops pushes but not unread.
  - Search scope; GET /dms summaries; pairs can't be added to.
- [x] **All suites pass.**
- [x] **Sandbox:** sandy makes a group with bob and cara (gateway script). Messages reach both; cara leaves; sandy removes bob; it shows in the DB and frames.

## Evidence (2026-10-20)
| Acceptance criterion | Evidence |
|---|---|
| Server | `dm-groups.test.js` (new, 3 tests; web-push mocked):<br>• **Create:** one other → BAD_REQUEST; a stranger → NOT_ALLOWED "(not eve)"; an unknown name → NOT_FOUND; 11 people → TOO_MANY. With ben (shared server), cyd (a friend) and yourself (ignored), and the name "  Gourd   Club " → group "Gourd Club", owner ann, members in order, the notice "ann started the group". Summaries and the notice reach all three; dot gets nothing. GET /dms and history show it (`kind: 'system'`); dot gets 404.<br>• **Messages:** after adding lou (away, subscribed), a message reaches ann, ben and cyd but not dot. Typing reaches ben (focused). lou's push is titled "Gourd Club", body "ann: hello group". A notice can't be edited, deleted or replied to. An edit reaches cyd, not dot. Search finds it for cyd, not dot.<br>• **Membership:** ben adds dot; ben can't add eve (NOT_ALLOWED); eve can't add (NOT_FOUND). One too many → TOO_MANY with nobody added; then exactly 10 → "ann added …". Only the owner removes: ben → NOT_ALLOWED; ann removes dot → `dm_left { reason: 'removed', name }`, 404, and no later messages. cyd renames it. Muted lou gets no push but still has unread; ben's `dm_mute` comes back in his summary only. ann (owner) leaves → `dm_left`, ben becomes owner, notices "ann left" / "ben is now the owner". A pair can't be added to. Everyone gone → the conversation and its messages are deleted |
| All suites | Server 52 files, 453. Web 102 files, 802 (untouched) |
| Sandbox (:3005, restarted) | Script with sandy, bob, cara and dee on sockets: sandy created conversation 5 with bob and cara. bob's GET /dms shows `kind: group`, three members, unread 1 (the notice). bob and cara posted; sandy named it "Gourd Club"; cara left; sandy removed bob. bob's later post was dropped, and his read gets 404. History: started / hi both / hey! / named / cara left / removed bob. Each person's frames stop when they leave (cara `left:left`, bob `left:removed`); dee got nothing. sandy leaving last deleted the group (no longer listed) |
