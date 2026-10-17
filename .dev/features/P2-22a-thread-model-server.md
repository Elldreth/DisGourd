# P2-22a — Thread data model + server API

- **Unit Type:** Implementation (child of P2-22)
- **Phase:** 2
- **State:** READY
- **Effort:** M
- **Depends on:** P2-22 decisions (done), P2-10, P2-13
- **Serialize with:** anything touching `server/db/index.js`, `server/gateway/chat.js`, `server/routes/spaces.js`

## Scope
- **Migration 8:**
  - `channels` gains `parent_id INTEGER REFERENCES channels(id) ON DELETE CASCADE`, `root_message_id INTEGER`, `thread_name TEXT`, `created_by INTEGER`, `last_activity_at INTEGER` and `archived_at INTEGER`.
  - Unique index on `root_message_id` (one thread per message).
  - Index on `(parent_id, last_activity_at)`.
- **Threads are channels:** `type = 'thread'`, named `~t<id>` (unreachable by `normalizeChannelName`).
  - `getChannelPerms(space, '~tN')` returns the parent's view/post roles.
  - `channelType` reports `'thread'`, and `gateway/chat.js` accepts it for `message`, `edit`, `delete`, `react`, `typing`, `pin` and `read`.
  - Posting bumps `last_activity_at` and clears `archived_at` (reopen on post, used by P2-22d).
- **Hidden from channel lists:**
  - `getUserSpaces` leaves threads out of `channels`, `voiceChannels` and `channelMeta`.
  - Creating, renaming, deleting or changing permissions on a `~t…` name through the channel routes gives 404.
  - Deleting the parent channel deletes its threads (cascade). Deleting a root message keeps the thread, with its summary showing "original message deleted".
- **API:**
  - `POST /spaces/:s/channels/:c/threads { messageId, name }`:
    - Any member who can **post** in `:c` may call it, and the message must be in `:c`.
    - `name` is 1–80 characters and defaults to the first 40 characters of the root message.
    - It returns `{ thread }`. A second create for the same message returns the existing thread (200).
    - It sends `thread_created { space, channel, thread }` to the parent's viewers.
  - `GET /spaces/:s/channels/:c/threads?archived=0|1` lists `{ id, channel: '~tN', name, rootMessageId, messageCount, lastActivityAt, archived, createdBy }`, newest activity first. Viewers only.
  - Thread history, `around`, pins and so on are the existing `/spaces/:s/channels/~tN/...` routes, unchanged.
- **Root message summary:** parent-channel messages carry `thread: { id, channel, name, messageCount, lastActivityAt } | null`, joined in `MESSAGE_SELECT`. `thread_updated { space, channel, rootMessageId, thread }` goes to parent viewers when a thread's count or name changes, so summaries stay live.
- **Search:** `searchMessages` results for thread messages carry `thread: { channel, name, parentChannel }`.

## Acceptance criteria
- [ ] `server/tests/threads.test.js`:
  - a member starts a thread from a message; parent viewers get `thread_created`; posting with `channel: '~tN'` reaches only parent viewers (a private parent's thread never leaks)
  - one thread per message (a second create returns the same thread)
  - a member who can't post in the parent can't start a thread (403)
  - `~tN` doesn't appear in `GET /spaces`; channel routes refuse `~t` names
  - thread history, `around` and pins work at `/channels/~tN/...`
  - the parent's history carries `thread` with the right `messageCount`, updated live by `thread_updated`
  - deleting the parent channel removes its threads
  - changing the parent's view permission immediately applies to its threads
- [ ] Every existing server test still passes, including the migrations test with its new index names.

## Expected Areas of Change
`server/db/migrations.js`, `server/db/index.js`, `server/gateway/chat.js`, `server/routes/spaces.js`, `server/permissions.js` (if needed), and a new `server/tests/threads.test.js`.

## Working Set / Blast Radius
~6 files. The risk is a hidden channel leaking into a list. Mitigate by filtering on `type = 'thread'` in the queries that list channels, and test each.
