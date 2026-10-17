# P2-22c — Following, unread and notifications for threads

- **Unit Type:** Implementation (child of P2-22)
- **Phase:** 2
- **State:** COMPLETE (merged in #99, 2026-10-17)
- **Effort:** M
- **Depends on:** P2-22a, P2-22b
- **Serialize with:** `notify.js`, `useChannelMessages.js`, `server/db/index.js` units

## Scope
- **Migration:** `thread_follows(user_id, thread_channel_id, PRIMARY KEY(user_id, thread_channel_id))`, cascading with the user and the channel.
- **Auto-follow** when you start a thread, post in it, or are @mentioned in it. `PUT/DELETE /spaces/:s/channels/~tN/follow` follows or unfollows by hand, with a Follow/Unfollow button in the thread panel.
- **Unread:**
  - The existing per-channel read markers work for `~tN` channels.
  - The connect-time `unread` frame and live counting include **followed threads only**. Unfollowed threads never badge.
  - Where it shows: a dot on the thread summary, a count on the Threads header button, and the parent channel shows as unread while a followed thread is.
- **Notifications** (P2-04 rules):
  - New messages in followed threads notify at your level ("All" for every message; "Mentions & DMs" for mentions only).
  - @mentions in any thread you can see always count as mentions, as in channels.
  - Do Not Disturb still silences everything.
  - The title reads "author in Thread name (#parent) · Server". Clicking it opens the thread panel.

## Acceptance criteria
- [x] Server tests:
  - auto-follow on start, post and mention
  - unfollow stops thread unread counting
  - the unread frame counts only followed threads
  - a mention in an unfollowed thread still counts as a mention
- [x] Web tests:
  - notifications follow the level for followed threads and are silent for unfollowed ones (except mentions)
  - badges appear on the summary, the Threads button and the parent channel
- [x] Sandbox: user B gets a notification (window in the background) for a followed thread's new message; after Unfollow, none.

## Expected Areas of Change
`server/db/migrations.js`, `server/db/index.js` (unread/mention queries), `server/gateway/index.js` (connect-time unread), `server/routes/spaces.js`, `web/src/notify.js`, `state/useChannelMessages.js`, `ThreadPanel.jsx`, `ChatPanel.jsx`, and tests.

## Working Set / Blast Radius
~8 files. The unread queries are hot paths, so keep the follow join indexed.

## Implementation notes
- Migration 9: `thread_follows(user_id, channel_id, followed_at)` with the primary key on `(user_id, channel_id)` (what the unread join uses) and `idx_thread_follows_channel` for the cascade when a thread goes.
- Auto-follow happens inside the existing write paths: `createThread` follows the creator; `storeMessageWithMentions` follows the author and the mentioned members when the channel is a thread, and returns `newFollows` (who just became a follower). The gateway sends each of them `thread_follow { space, channel, parentChannel, name, followed }`; the same frame goes out for the `PUT`/`DELETE …/follow` routes, only when something changed.
- `getUnreadCounts` includes a thread only when followed; `getMentionCounts` includes every thread you can see. Thread rows carry `parent` (channel rows don't, so the frame is unchanged for them). The connect-time `unread` frame gains `threads`: the threads you follow, with their parent and name.
- A `message` frame in a thread now carries `thread: { name, parentChannel }`, which the client uses for the notification title and to place the badge.
- Client: the channel instance of `useChannelMessages` keeps `threads` (`unreadKey → { parent, name, followed }`) from the unread frame, `thread_follow` frames and thread messages. A reply in a thread counts as unread only if followed; a mention counts whatever the follow state; replies in the thread open in the panel (`openThread`) never count (the panel reads them). `badgeCounts` rolls thread counts into the parent channel and the server, and reports `channelThreads` (how many threads in a channel have something unread) for the Threads button.
- Notifications: `attentionKind` treats the open thread like the open channel ("looking" while focused); the title is "author in Thread name (#parent) · Server" and clicking it opens the thread panel. Level, DND and sounds work as before.
- Not done here: typing indicators in threads (P2-22b Discovered Work, unchanged).

## Evidence (2026-10-17)
| Acceptance criterion | Evidence |
|---|---|
| Auto-follow on start, post and mention | `server/tests/thread-follows.test.js` "starting a thread follows it…" (the creator gets `thread_follow`, the list shows `followed`) and "posting in a thread follows it, and so does being @mentioned…" (the author and the mentioned user get the frame; a reader doesn't; the frame isn't repeated) |
| Unfollow stops thread unread counting | "unfollowing stops the unread count…": after `DELETE …/follow` the thread is gone from `counts` and `threads`; `PUT` brings it back |
| The unread frame counts only followed threads | "the connect-time unread frame counts followed threads (with their parent) and not others": cat (mentioned, so following) gets `count: 2, parent: 'general'` and the thread in `threads`; owner (not following) gets neither |
| A mention in an unfollowed thread still counts as a mention | Same test, and after unfollowing: `mentions` still has the thread with `count: 1` |
| Guards | "only threads you can see can be followed, and only threads" (404 for a channel, 403 for a private channel's thread); "reading the thread clears its count; deleting the thread drops the follow" |
| Notifications follow the level for followed threads and are silent for unfollowed ones (except mentions) | `useChannelMessages.thread.test.js` "following threads (P2-22c)": an unfollowed reply never reaches the notifier, a mention does; after `thread_follow` every reply does and counts as unread; unfollowing drops the badge and stops them. `notify.test.js` "threads": the open thread is "looking" while focused; the title names the thread and its channel |
| Badges on the summary, the Threads button and the parent channel | `MessageList.test.jsx` "thread badges": the summary reads ", unread" / ", 1 mention". `ChatPanel.threads.test.jsx`: "Threads (2 unread)". `useChannelMessages.test.js` "badgeCounts rolls followed threads into their parent channel and server". `ThreadPanel.test.jsx`: Follow / Following toggles and calls `onToggleFollow` |
| Full suites | Server: 23 suites, 239 tests. Web: 51 files, 461 tests. `vite build` clean |
| Sandbox (:3005, sandbox DB; upgraded to `user_version` 9 on start) | sandy (localhost) and bob (127.0.0.1), "Tx Check" #general, bob's notification level set to All and `Notification` replaced by a recording stub in his tab. bob opened "Board game night", pressed **Follow** (it became **Following**), and closed it. sandy replied "@bob can you host?": bob's tab recorded one notification titled "sandy in Board game night (#general) · Tx Check", the summary read "4 replies, 1 mention", the Threads button "Threads (1 unread)", and the tab title went to "(3)". sandy's own button flipped to **Following** live (she had posted). bob opened the thread: badges cleared and the title went back to "(2)". He pressed **Unfollow** (back to **Follow**) and closed it. sandy's plain reply then gave bob no notification and no badge. No new console errors |
