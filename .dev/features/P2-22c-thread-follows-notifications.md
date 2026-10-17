# P2-22c — Following, unread and notifications for threads

- **Unit Type:** Implementation (child of P2-22)
- **Phase:** 2
- **State:** PLANNED (READY after P2-22b)
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
- [ ] Server tests:
  - auto-follow on start, post and mention
  - unfollow stops thread unread counting
  - the unread frame counts only followed threads
  - a mention in an unfollowed thread still counts as a mention
- [ ] Web tests:
  - notifications follow the level for followed threads and are silent for unfollowed ones (except mentions)
  - badges appear on the summary, the Threads button and the parent channel
- [ ] Sandbox: user B gets a notification (window in the background) for a followed thread's new message; after Unfollow, none.

## Expected Areas of Change
`server/db/migrations.js`, `server/db/index.js` (unread/mention queries), `server/gateway/index.js` (connect-time unread), `server/routes/spaces.js`, `web/src/notify.js`, `state/useChannelMessages.js`, `ThreadPanel.jsx`, `ChatPanel.jsx`, and tests.

## Working Set / Blast Radius
~8 files. The unread queries are hot paths, so keep the follow join indexed.
