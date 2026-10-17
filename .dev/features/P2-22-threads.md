# P2-22 — Threads (Container, L)

- **Unit Type:** Container (decomposed 2026-10-17 into P2-22a–d)
- **Phase:** 2, rank 14
- **State:** COMPLETE (all four children merged: #97, #98, #99, #100; 2026-10-17)
- **Effort:** L in total
- **Depends on:** P2-09 and P2-10 (replies, `around` jump, newer-page loading), P1-08, P1-09, P2-13 (pins, now reused by threads)
- **Requirement Source:** IMPROVEMENT-PLAN.md Phase 2 #14

## Decisions (user, 2026-10-17)
| Question | Decision |
|---|---|
| Data model | **Hidden child channels.** A thread is a `channels` row with `type = 'thread'`, a `parent_id` and a `root_message_id`, named `~t<id>`. User channel names are normalised to `a-z0-9_-`, so this name can never collide. |
| Who can start a thread | **Anyone who can post** in the parent channel, from any message there. |
| Archiving | **After 7 quiet days.** Archived threads drop out of the active list but stay readable; posting in one reopens it. |
| Notifications | **Follow threads.** You auto-follow threads you start, post in or are @mentioned in. Followed threads show unread and notify at your normal level, and you can unfollow. |

Non-goals: threads in DMs, threads inside threads, forum channels.

## Why child channels fit this codebase
Everything about messages is keyed by *(server, channel name)*: history and paging, `around`, pins, reactions, link previews, replies, edits and deletes, read markers, mentions, typing, and permission-filtered delivery (`deliverToChannelViewers`). A thread that *is* a channel gets all of that unchanged. The cost is a few targeted changes:
- `getChannelPerms` resolves a thread to its **parent's** view/post roles, so private channels' threads stay private, and changing the parent's permissions applies to its threads with no syncing.
- `getUserSpaces` and the channel-management routes **leave threads out** of channel lists.
- `gateway/chat.js` accepts `type = 'thread'` where it checks `'text'`.
- Display: anything that shows a channel name (notifications, search results, the quick switcher) shows a thread as "Thread name (#parent)".

Client snag found during planning: `state/gatewayHandlers.js` keeps **one handler per frame type** (`Object.assign`), so a second `useChannelMessages` (the thread panel) would replace the channel's handlers. P2-22b makes the table compose handlers.

## Children (run in order a → b → c; d after a)
| ID | Title | Effort | Depends on |
|---|---|---|---|
| P2-22a | Thread data model + server API | M | — |
| P2-22b | Thread panel and summaries (client), with composable gateway handlers | M | P2-22a |
| P2-22c | Following, unread and notifications for threads | M | P2-22a, P2-22b |
| P2-22d | Auto-archive after 7 quiet days | S | P2-22a |
