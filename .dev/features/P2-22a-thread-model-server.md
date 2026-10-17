# P2-22a — Thread data model + server API

- **Unit Type:** Implementation (child of P2-22)
- **Phase:** 2
- **State:** REVIEW
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
- [x] `server/tests/threads.test.js`:
  - a member starts a thread from a message; parent viewers get `thread_created`; posting with `channel: '~tN'` reaches only parent viewers (a private parent's thread never leaks)
  - one thread per message (a second create returns the same thread)
  - a member who can't post in the parent can't start a thread (403)
  - `~tN` doesn't appear in `GET /spaces`; channel routes refuse `~t` names
  - thread history, `around` and pins work at `/channels/~tN/...`
  - the parent's history carries `thread` with the right `messageCount`, updated live by `thread_updated`
  - deleting the parent channel removes its threads
  - changing the parent's view permission immediately applies to its threads
- [x] Every existing server test still passes, including the migrations test with its new index names.

## Expected Areas of Change
`server/db/migrations.js`, `server/db/index.js`, `server/gateway/chat.js`, `server/routes/spaces.js`, `server/permissions.js` (if needed), and a new `server/tests/threads.test.js`.

## Working Set / Blast Radius
~6 files. The risk is a hidden channel leaking into a list. Mitigate by filtering on `type = 'thread'` in the queries that list channels, and test each.

## Implementation notes
- A thread's channel is named `~t<root message id>`.
- Its row **copies the parent's view/post roles**, and `setChannelPerms` updates a channel's threads in the same call. So every query that filters on `c.view_role` (unread counts, mention counts, search) stays correct with no extra joins. `getChannelPerms` also resolves through `parent_id`, as a backstop.
- The one-thread-per-message index is partial: `idx_threads_root` on `root_message_id WHERE root_message_id IS NOT NULL`. `idx_threads_parent` is on `(parent_id, last_activity_at)`.
- Unread and mention counts **leave threads out** for now. Thread unread state belongs to the follow model in P2-22c.
- `thread_updated` goes out on every post and delete in a thread. It carries the full thread object (a superset of the summary fields).

## Evidence (2026-10-17)
| Acceptance criterion | Evidence |
|---|---|
| Start a thread; parent viewers get `thread_created`; replies reach only parent viewers | `threads.test.js` "a member starts a thread…" and "posting in the thread…" (a stranger gets neither frame) |
| A private parent's thread never leaks | "a private channel's threads stay private everywhere": history 403, list 403, gateway frame withheld, search empty for the member (the admin's result carries `thread: { name, parentChannel }`), and not in unread or mention counts |
| One thread per message | "one thread per message…": a second create returns 200 with the same thread; the default name is cut to 40 characters |
| Can't post in the parent → 403 | "you need to be able to post…": a read-only member gets 403; wrong channel 404; voice or thread parent 400; a name over 80 characters 400 |
| Hidden from `GET /spaces`; channel routes refuse `~t` | "threads are listed… and hidden" and "thread channels are not managed like normal channels" (DELETE and PATCH return 404; creating `~t9999` gives `t9999`) |
| History, `around` and pins at `/channels/~tN` | "thread history, around and pins all work" |
| The parent's history carries `thread` with a live `messageCount` | "posting in the thread…": `thread_updated` has `messageCount: 1`; the root's `thread` matches; other messages have `thread: null`; replies aren't in the parent's history |
| Deleting the parent removes its threads | "deleting the root keeps the thread; deleting the parent channel removes its threads" |
| A parent permission change applies at once | "changing the parent's access applies to its threads at once" (200 → 403 → 200) |
| Full server suite | `npx jest`: 22 suites, 233 tests, all passing (includes the migrations test with `idx_threads_parent` and `idx_threads_root`) |
| Sandbox (:3005, sandbox DB only) | The existing v7 sandbox DB upgraded to `user_version` 8 on start. In "Tx Check", bob started a thread on message 640 (201, name cut to 40). Sandy's second create returned 200 with the same `~t640`. Bob's reply over the gateway gave sandy `thread_updated` with `messageCount: 1`. The thread history held the reply; the parent's history didn't, and its root showed `thread.messageCount: 1`. The list showed the thread; `~t` was absent from `/spaces`; `DELETE /channels/~t640` returned 404. |

## Discovered Work
- P2-22c must add followed threads to unread and mention counts. This unit leaves threads out of both, on purpose.
