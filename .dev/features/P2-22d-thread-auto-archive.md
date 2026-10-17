# P2-22d — Auto-archive threads after 7 quiet days

- **Unit Type:** Implementation (child of P2-22)
- **Phase:** 2
- **State:** PLANNED (READY after P2-22a)
- **Effort:** S
- **Depends on:** P2-22a (`last_activity_at`, `archived_at`, and reopening on post)
- **Serialize with:** `server/gateway/index.js` (the status sweep lives there too)

## Scope
- **Sweep:** an hourly sweep (alongside the custom-status sweep) sets `archived_at` on threads whose `last_activity_at` is more than 7 days ago. It sends `thread_updated` (`archived: true`) to the parent's viewers.
- **Archived threads:**
  - drop out of the active list but stay readable
  - show in the Threads list under "Archived"
  - **posting in one reopens it** (P2-22a), sending `thread_updated` (`archived: false`)
- **By hand:** people with `pin_messages` (moderators) can **Archive** or **Reopen** a thread from its panel.
- **Configurable:** `THREAD_ARCHIVE_DAYS` (default 7) for the server owner.

## Acceptance criteria
- [ ] Server tests:
  - the sweep archives a thread quiet for more than 7 days (with `last_activity_at` set in the past) and leaves an active one alone
  - posting reopens it
  - manual archive/reopen respects the permission
  - `THREAD_ARCHIVE_DAYS` is honoured
- [ ] Web test: the archived state shows in the panel and list; Reopen works.
- [ ] Sandbox: set a thread's `last_activity_at` in the **sandbox DB only**; it moves to Archived within the sweep window, and a post brings it back.

## Expected Areas of Change
`server/gateway/index.js`, `server/db/index.js`, `server/routes/spaces.js`, `ThreadPanel.jsx`, `ThreadsList.jsx`, and tests.

## Working Set / Blast Radius
~5 files, small.
