# P3-12 — Up arrow in an empty composer edits your last message

- **Unit Type:** Implementation
- **Phase:** 3 — "Keyboard shortcuts: ↑ to edit your last message"
- **State:** COMPLETE (merged in #74)
- **Effort:** S
- **Depends on:** P3-05 (MessageList restructuring; editing state gets lifted)
- **Serialize with:** Composer.jsx and MessageList.jsx units
- **Requirement Source:** IMPROVEMENT-PLAN.md Phase 3

## Scope
- Move `editing` state from MessageRow up to MessageList, as `editingId` plus a setter. Expose `startEditLast()` (the newest loaded message where `author === me`) through a ref or callback.
- Composer: on ArrowUp with an empty textarea, no mention popup and no pending attachments, call `onEditLast()`. When editing finishes (save or Esc), focus returns to the composer.
- Works in channels and DMs.

## Acceptance criteria
- [x] In an empty composer, ↑ opens your last message in edit mode with the caret at the end. Enter saves, and focus returns to the composer.
- [x] ↑ with text in the composer moves the caret as normal.
- [x] With no own messages loaded, nothing happens.

## Expected Areas of Change
`Composer.jsx`, `MessageList.jsx`, `ChatPanel.jsx`, `DmPanel.jsx`.

## Working Set / Blast Radius
4 files.

## Evidence
| Check | Result |
|---|---|
| `MessageList.test.jsx` (+4): `startEditLast()` opens your newest message (not a later one from someone else), caret at the end; Enter saves via `onEdit` and calls `onEditDone`; Esc cancels and calls `onEditDone`; attachment-only messages are skipped; none of yours loaded -> returns false, nothing opens | pass (failed first) |
| `Composer.test.jsx` (+4): ↑ in an empty box calls `onEditLast` and prevents the default; with text it doesn't; when there's nothing to edit the key is left alone; not while files are pending | pass (the two "does something" cases failed first; the two "leaves it alone" cases passed before, as they should) |
| Full suite / build | web 293/293, lint clean, build ok |
| Sandbox, real key presses (#history): "x" then ↑ -> no edit; Ctrl+A, Backspace, ↑ -> "history msg 300" in edit, focused, caret 15/15; typed, Enter -> saved "(edited)", focus back in "Message #history" | pass |
| Sandbox: #random (none of sandy's messages loaded): ↑ -> nothing | pass |
| Sandbox DMs: ↑ -> "sandy replies in the DM" (the newer image-only DM skipped), caret at end; Esc -> focus back in "Message @bob" | pass |
| Regression: the toolbar's Edit button still returns focus to the message row on Esc | pass |

## Implementation notes
- `MessageList` (now `forwardRef`) owns `editingId` and exposes `startEditLast()`; `MessageRow` takes `editing` / `onStartEdit` / `onEndEdit` instead of its own state, and resets its draft and puts the caret at the end whenever editing starts.
- Focus after an edit: back to the composer only when the composer's ↑ started it (`onEditDone`); edits from the toolbar / menu / `E` key still return focus to the row, as before.
- Added during the work: attachment-only messages are skipped by ↑ (an empty edit box for a picture isn't useful), found in the DM sandbox check.
- `Composer` exposes `focus()` alongside `addFiles()`.

## Not verified
- Touch devices (no ↑ key; unchanged there).
