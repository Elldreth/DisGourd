# P3-09 — Undo toast for message delete (replace window.confirm)

- **Unit Type:** Implementation
- **Phase:** 3 — "or better, an undo toast"
- **State:** REVIEW (PR open)
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
- [x] Delete, then Undo within 5s: the message reappears, and other clients never saw it disappear.
- [x] Delete and wait: other clients see it removed after about 5s.
- [x] Delete, then close the tab immediately: the delete still happens (best effort). Note: the gateway send on pagehide isn't guaranteed. Document this.
- [x] Screen readers announce the toast. Undo is reachable by keyboard (focus isn't stolen; Ctrl+Z within 5s is optional). Toasts are in a polite live region; the Undo button is in the normal Tab order (after the app). Ctrl+Z was not added (optional; it would clash with text undo in the composer). Not tried with a real screen reader.

## Expected Areas of Change
New `Toasts.jsx`, `App.jsx` (host), `MessageActions.jsx`/`MessageList.jsx`, the channel and DM hooks.

## Working Set / Blast Radius
~5 files.

## Evidence
| Check | Result |
|---|---|
| `useUndoDelete.test.js` (5, fake timers): hidden at once, toast "Message deleted · Undo", nothing sent for 5 s, sent at 5 s; Undo restores and never sends; `pagehide` sends pending deletes at once (and not again); once the server removes it, it stays gone; if it's still in the list 5 s after sending, it comes back with "Couldn't delete that message" | pass (failed first) |
| `Toasts.test.jsx` (3): polite live region; auto-dismiss after the duration; the action button works and the toast never takes focus; same id replaces, dismiss removes | pass (failed first) |
| `MessageList.test.jsx` (+1): Delete with `window.confirm` made to throw -> `onDelete` called, no popup | pass (failed first) |
| Full suite / build | web 337/337, lint clean, build ok; no `window.confirm` left in `web/src` |
| Sandbox (sandy deletes in #second-offline, bob listening on his own socket): Delete key on "undo test two" -> hidden, toast "Message deleted Undo", focus moved to "undo test one", bob saw nothing; left alone -> bob received `message_delete` for it after the 5 s | pass |
| Sandbox: Delete on "undo test one", Undo after 1 s -> it came back; bob never received a delete; still there 7 s later | pass |
| Sandbox: Delete, then reload 0.2 s later -> the message was gone from the server after the reload (`pagehide` flush) | pass (best effort, see below) |

## Implementation notes
- `Toasts.jsx`: `ToastProvider` (mounted in `main.jsx` around App) + `useToasts()`; `show({ id, message, actionLabel, onAction, duration, tone })`, `dismiss(id)`. Without a provider (App's smoke test) toasts are a no-op.
- `state/useUndoDelete.js`: `request(key, { send, exists })`, keys `c:<id>` / `d:<id>` for channel and DM messages; App filters hidden messages out before passing them to ChatPanel / DmPanel. Moderator deletes go through the same path.
- The server sends nothing when it refuses a delete, so after sending the client waits 5 s for the message to leave the list; if it's still there it's restored with an error toast.
- MessageList: focus moves to the next (or previous) message before the deleted one hides, so keyboard users aren't dropped to the page.
- **`pagehide` is best effort:** the gateway send happens while the page is unloading; a browser may close the socket first, in which case the delete is lost (the message stays). It worked in the sandbox reload test.

## Not verified
- A real screen reader announcing the toast.
- The refused-delete path live (it needs a delete the server rejects; covered by the unit test).
