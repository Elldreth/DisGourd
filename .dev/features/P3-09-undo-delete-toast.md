# P3-09 — Undo toast for message delete (replace window.confirm)

- **Unit Type:** Implementation
- **Phase:** 3 — "or better, an undo toast"
- **State:** PLANNED
- **Effort:** S–M
- **Depends on:** P3-05 (Delete lives in MessageActions)
- **Serialize with:** App.jsx units (toast host), MessageList/MessageActions units
- **Requirement Source:** IMPROVEMENT-PLAN.md Phase 3

## Scope
- New `web/src/components/Toasts.jsx` plus a `useToasts()` context. The host is mounted once in App. Use `aria-live="polite"`. The existing `loadError` banner may migrate to it (optional).
- Delete flow:
  - hide the message locally (pending-delete set)
  - show "Message deleted · Undo" for 5s
  - on timeout, send the `delete`/`dm_delete` op
  - Undo restores the message
  - on `pagehide`, flush pending deletes immediately
  - if the op fails (the message is gone or not permitted), restore the message and show an error toast
- This also applies to moderator deletes (P1-10) once that lands.

## Acceptance criteria
- [ ] Delete, then Undo within 5s: the message reappears, and other clients never saw it disappear.
- [ ] Delete and wait: other clients see it removed after about 5s.
- [ ] Delete, then close the tab immediately: the delete still happens (best effort). Note: the gateway send on pagehide isn't guaranteed. Document this.
- [ ] Screen readers announce the toast. Undo is reachable by keyboard (focus isn't stolen; Ctrl+Z within 5s is optional).

## Expected Areas of Change
New `Toasts.jsx`, `App.jsx` (host), `MessageActions.jsx`/`MessageList.jsx`, the channel and DM hooks.

## Working Set / Blast Radius
~5 files.
