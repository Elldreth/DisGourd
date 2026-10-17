# P2-22d — Auto-archive threads after 7 quiet days

- **Unit Type:** Implementation (child of P2-22)
- **Phase:** 2
- **State:** COMPLETE (merged in #100, 2026-10-17)
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
- [x] Server tests:
  - the sweep archives a thread quiet for more than 7 days (with `last_activity_at` set in the past) and leaves an active one alone
  - posting reopens it
  - manual archive/reopen respects the permission
  - `THREAD_ARCHIVE_DAYS` is honoured
- [x] Web test: the archived state shows in the panel and list; Reopen works.
- [x] Sandbox: set a thread's `last_activity_at` in the **sandbox DB only**; it moves to Archived within the sweep window, and a post brings it back.

## Expected Areas of Change
`server/gateway/index.js`, `server/db/index.js`, `server/routes/spaces.js`, `ThreadPanel.jsx`, `ThreadsList.jsx`, and tests.

## Working Set / Blast Radius
~5 files, small.

## Implementation notes
- `config.threadArchiveDays` reads `THREAD_ARCHIVE_DAYS` (default 7); documented in the README's environment table.
- `sweepQuietThreads()` in `gateway/index.js` runs hourly and once right after start-up (so a restart catches up), archiving open threads whose `last_activity_at` is older than the limit and sending `thread_updated` to each parent's viewers. Posting already clears `archived_at` (P2-22a), and the existing `thread_updated` after a post carries `archived: false`.
- `PUT`/`DELETE /spaces/:s/channels/~tN/archive` archive or reopen by hand, gated by the server's `pin_messages` threshold (moderators), and send `thread_updated` when something changed.
- The thread summary under a root message now carries `archived` (`MESSAGE_SELECT` joins `archived_at`), so the client shows "· archived" there and in the Threads list. The thread panel shows a notice ("This thread is archived. A reply reopens it.") and, for people who may pin, an Archive / Reopen button; App keeps the open thread's archived state live from `thread_updated`.

## Evidence (2026-10-17)
| Acceptance criterion | Evidence |
|---|---|
| The sweep archives a quiet thread and leaves an active one alone | `server/tests/thread-archive.test.js` "the sweep archives a thread quiet for longer than THREAD_ARCHIVE_DAYS…": with `THREAD_ARCHIVE_DAYS=3`, a 4-day-quiet thread is archived (viewers get `thread_updated { archived: true }`, the lists and the root summary agree) and a 2-day-quiet one isn't; a second sweep does nothing |
| Posting reopens it | "posting in an archived thread reopens it": `thread_updated { archived: false }` and the thread is back in the active list |
| Manual archive/reopen respects the permission | "moderators can archive and reopen by hand; members cannot": member 403, admin 200 both ways, a channel name 404; "an archived thread stays readable" |
| `THREAD_ARCHIVE_DAYS` is honoured | The same first test: the limit is 3 days there (the default 7 would have spared both threads) |
| Web: archived state in the panel and list; Reopen works | `ThreadPanel.test.jsx` "archived threads": the notice shows, replies stay readable, the composer stays, Reopen calls `onSetArchived(false)`; Archive offered to moderators only. `ThreadsList.test.jsx`: the Archived toggle lists archived threads marked "· archived" and opens one. `MessageList.test.jsx`: the summary reads "archived" |
| Full suites | Server: 24 suites, 243 tests. Web: 52 files, 465 tests. `vite build` clean |
| Sandbox (:3005, sandbox DB only) | Set "Board game night"'s `last_activity_at` to 8 days ago in the sandbox DB and restarted the sandbox server: the start-up sweep archived it (`archived_at` set). In the app the summary read "5 replies · last October 9, 2026 · archived"; the Threads list showed it only under **Archived**; opening it showed the notice with a Reopen button (sandy is the owner) and the replies. A reply reopened it live: the notice went, the button became Archive, the summary lost "archived". Pressing **Archive** put it back. No new console errors |
