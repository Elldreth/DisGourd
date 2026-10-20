# P9-06b — Conversations in the app

- **Unit Type:** Implementation (child of P9-06)
- **Phase:** 9
- **State:** PLANNED (READY once P9-06a merges)
- **Effort:** M
- **Depends on:** P9-06a

## Scope
No visible change. The app keys DMs by conversation id, ready for groups.

- **`useDms`:**
  - `current`, `unread`, `typing` and paging keys are conversation ids.
  - Conversations come from GET /dms with their `members`.
  - Send, read, focus and typing use `conversation`. Incoming frames are matched by `conversation`.
  - `open(username)` still works: it finds the pair, or opens a not-yet-created one that the first message creates. The server answers with the conversation id on the first send, as `dm` frames do.
  - The new-message divider counts messages not written by me.
- **Elsewhere in the app:**
  - `App` and `useSpaces` save `{ dm: conversationId }`. An old saved username is still restored by looking it up.
  - The switcher key is `d:<conversationId>`.
  - Search results open `conversationId`.
  - In `notify.js`, "this DM is open" means the same conversation; the tag and click open the conversation.
  - Push data and the service worker's click open the conversation, with `data.dm` as the fallback for older pushes.
- **`DmSidebar` and `DmPanel`:** rows and the header read from the conversation (for a pair, the other member). Same look as today.
- **Server cleanup:** once the app no longer uses the old username paths and ops, P9-06c may drop them. Note it, don't do it here.

## Acceptance criteria
- [ ] **Web:** the `useDms` tests run on conversation ids (frames, unread, typing, paging, opening by username). The tests for restoring the saved view, the switcher, search, notifications and push clicks pass with conversation ids.
- [ ] **All suites pass;** `vite build` is clean.
- [ ] **Sandbox:** DMs look and work the same as before, across a reload and from a notification click. A new DM with someone you haven't messaged works.
