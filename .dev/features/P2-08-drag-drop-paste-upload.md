# P2-08 — Drag-and-drop and paste-to-upload

- **Unit Type:** Implementation
- **Phase:** 2, rank 5
- **State:** READY
- **Effort:** S
- **Depends on:** none
- **Serialize with:** Composer.jsx units (P2-06, P2-09, P3-12), ChatPanel.jsx units (P3-10, P1-10)
- **Requirement Source:** IMPROVEMENT-PLAN.md Phase 2 #5. Revalidated: Composer only uploads through the hidden `<input type=file>`. No `onPaste` or `onDrop` exists outside the ServerRail reorder.

## Scope
- Composer: refactor `pickFile` into `addFiles(fileList)`, keeping the 10-file cap and the error messages. The textarea gets `onPaste`: if `clipboardData.files.length > 0`, `preventDefault()` and call `addFiles`. Pasting text is unaffected. A pasted screenshot with no filename gets `pasted-image-<ts>.png`.
- Expose `addFiles` through `forwardRef` + `useImperativeHandle`.
- ChatPanel and DmPanel: a drop zone over the main area. On `dragenter` with `dataTransfer.types.includes('Files')`, show an overlay: "Drop to upload to #channel". On drop, forward to `composerRef.current.addFiles`. No overlay when `!canPost`. Use a counter so drags over child elements don't flicker.

## Acceptance criteria
- [ ] Paste a screenshot (Ctrl+V): a thumbnail is pending, Send posts it.
- [ ] Drag 3 files from the OS onto the chat: overlay, then drop, then 3 pending.
- [ ] Dragging a server icon in the rail never shows the overlay.
- [ ] Dropping 12 files attaches 10 and shows the existing cap message.
- [ ] Works in DMs.

## Expected Areas of Change
`web/src/components/Composer.jsx`, `web/src/components/ChatPanel.jsx`, `web/src/components/DmPanel.jsx`.

## Working Set / Blast Radius
3 files.
