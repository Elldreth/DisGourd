# P2-22 — Threads (Container, L)

- **Unit Type:** Container
- **Phase:** 2, rank 14
- **State:** PLANNED
- **Effort:** L
- **Depends on:** P2-09 and P2-10 (the reply infrastructure and `around` pagination), P1-08, P1-09
- **Requirement Source:** IMPROVEMENT-PLAN.md Phase 2 #14

## Why it isn't decomposed further now
The thread model depends on decisions that replies (P2-09) will settle: how `reply_to` renders and how jump/pagination works. Decompose once P2-10 has landed. The preliminary slices:
1. Data model: either `threads(id, channel_id, root_message_id, name, archived)` with `messages.thread_id`, or threads modelled as hidden child channels (reuses all of the channel machinery, including unread, permissions and pagination). **The recommended option is child channels.** Flag this for the human.
2. Server ops and REST: create a thread from a message, post, and list active threads.
3. Client: a thread side panel, a thread summary under the root message, and unread state for threads.
4. Notifications and unread integration.

## Open questions
- FLAG: auto-archive policy? Thread membership and notification semantics?
