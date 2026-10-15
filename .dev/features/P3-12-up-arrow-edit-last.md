# P3-12 — Up arrow in an empty composer edits your last message

- **Unit Type:** Implementation
- **Phase:** 3 — "Keyboard shortcuts: ↑ to edit your last message"
- **State:** PLANNED
- **Effort:** S
- **Depends on:** P3-05 (MessageList restructuring; editing state gets lifted)
- **Serialize with:** Composer.jsx and MessageList.jsx units
- **Requirement Source:** IMPROVEMENT-PLAN.md Phase 3

## Scope
- Move `editing` state from MessageRow up to MessageList, as `editingId` plus a setter. Expose `startEditLast()` (the newest loaded message where `author === me`) through a ref or callback.
- Composer: on ArrowUp with an empty textarea, no mention popup and no pending attachments, call `onEditLast()`. When editing finishes (save or Esc), focus returns to the composer.
- Works in channels and DMs.

## Acceptance criteria
- [ ] In an empty composer, ↑ opens your last message in edit mode with the caret at the end. Enter saves, and focus returns to the composer.
- [ ] ↑ with text in the composer moves the caret as normal.
- [ ] With no own messages loaded, nothing happens.

## Expected Areas of Change
`Composer.jsx`, `MessageList.jsx`, `ChatPanel.jsx`, `DmPanel.jsx`.

## Working Set / Blast Radius
4 files.
