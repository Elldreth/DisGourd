# P9-07b — Blocking in the app

- **Unit Type:** Implementation (child of P9-07)
- **Phase:** 9
- **State:** PLANNED (READY once P9-07a merges)
- **Effort:** M
- **Depends on:** P9-07a

## Scope
- **State:** a `useBlocks` hook loads GET /blocks after sign-in and reloads on `blocks_changed`. It exposes `isBlocked(username)`, `block(username)` and `unblock(username)`.
- **Block / Unblock in four places:**
  - the member list menu;
  - a 1-to-1 DM's header ("…" or a button);
  - a message's "…" menu, beside Report;
  - Settings › My account › **Blocked people**: the list with Unblock, or "You haven't blocked anyone."
  - Blocking asks first: "Block bob? They can't message you or add you to groups, and their messages are hidden behind 'Show'. They aren't told." Unblocking is immediate.
- **Messages in servers, threads and groups:**
  - A blocked person's message renders as a small row, **"Blocked message · Show"**. Show reveals that message until you leave the channel.
  - Consecutive blocked messages collapse into one row ("3 blocked messages · Show").
  - Replies quoting a blocked message show "Blocked message" as the quote.
- **Notifications and typing:**
  - `notify.js` ignores frames from blocked people: no desktop notification and no sound.
  - Their name is dropped from typing lines.
- **A blocked 1-to-1:**
  - The composer is replaced by a bar: "You've blocked bob. Unblock to message." (with Unblock), or "You can't message this person" when they've blocked you, as GET /dms `blocked` says.
  - A `BLOCKED` refusal from the server shows as a toast.
- **The new-message and group pickers** leave out people you've blocked.

## Acceptance criteria
- [ ] **Web:**
  - The hook (load, block, unblock, the frame).
  - Each of the four places (with the confirm).
  - Collapsed messages and grouped runs, with Show.
  - A reply quote from a blocked person; no notification or sound; typing filtered.
  - The DM bar (both cases); the pickers filtered; the Settings list.
- [ ] **All suites pass;** `vite build` is clean.
- [ ] **Sandbox, in two browsers:**
  - sandy blocks bob from the member list.
  - bob's messages in Tx Check collapse for sandy, and Show reveals one.
  - The DM bar appears for both of them.
  - Unblock from Settings, and everything is back.
