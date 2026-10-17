# P2-08 — Drag-and-drop and paste-to-upload

- **Unit Type:** Implementation
- **Phase:** 2, rank 5
- **State:** REVIEW (PR open)
- **Effort:** S
- **Depends on:** none
- **Serialize with:** Composer.jsx units (P2-06, P2-09, P3-12), ChatPanel.jsx units (P3-10, P1-10)
- **Requirement Source:** IMPROVEMENT-PLAN.md Phase 2 #5. Revalidated: Composer only uploads through the hidden `<input type=file>`. No `onPaste` or `onDrop` exists outside the ServerRail reorder.

## Scope
- Composer: refactor `pickFile` into `addFiles(fileList)`, keeping the 10-file cap and the error messages. The textarea gets `onPaste`: if `clipboardData.files.length > 0`, `preventDefault()` and call `addFiles`. Pasting text is unaffected. A pasted screenshot with no filename gets `pasted-image-<ts>.png`.
- Expose `addFiles` through `forwardRef` + `useImperativeHandle`.
- ChatPanel and DmPanel: a drop zone over the main area. On `dragenter` with `dataTransfer.types.includes('Files')`, show an overlay: "Drop to upload to #channel". On drop, forward to `composerRef.current.addFiles`. No overlay when `!canPost`. Use a counter so drags over child elements don't flicker.

## Acceptance criteria
- [x] Paste a screenshot (Ctrl+V): a thumbnail is pending, Send posts it.
- [x] Drag 3 files from the OS onto the chat: overlay, then drop, then 3 pending.
- [x] Dragging a server icon in the rail never shows the overlay.
- [x] Dropping 12 files attaches 10 and shows the existing cap message.
- [x] Works in DMs.

## Expected Areas of Change
`web/src/components/Composer.jsx`, `web/src/components/ChatPanel.jsx`, `web/src/components/DmPanel.jsx`.

## Working Set / Blast Radius
3 files.

## Evidence
| Check | Result |
|---|---|
| `Composer.test.jsx` (4): pasting an unnamed image attaches it as `pasted-image-<ts>.png` and Send posts it; pasting text is untouched; `addFiles` keeps the 10-file cap with the existing message; real names are kept | pass (3 failed first; the text-paste one passed before, as it should) |
| `useFileDrop.test.jsx` (6): overlay on file drag, files handed over on drop; no flicker over children (enter/leave counter); non-file drags ignored; disabled when you can't post; cleared on `dragend`; file drops outside the panel don't make the browser open the file | pass (failed first) |
| Full suite / build | web 143/143, lint clean, build ok |
| Sandbox (real browser `DragEvent` / `ClipboardEvent` with real PNG files; an OS drag can't be automated): text-only drag (like a server icon) shows no overlay; 3 files: overlay "Drop to upload to #made-offline", drop -> "3 files" pending, Send -> one message with 3 images; pasted unnamed image -> 1 pending, sent as `/uploads/.../pasted-image-<ts>.png`; 12 files -> 10 pending + "Only the first 10 files are attached"; DM with bob: overlay "Drop to upload to @bob", file sent; no console errors | pass |

## Implementation notes
- `Composer` is now a `forwardRef` exposing `addFiles(files)`; the + button, paste and drop all go through it. Disabled composers ignore it.
- `useFileDrop` (new, `web/src/useFileDrop.js`) + `DropOverlay.jsx` (new) are shared by ChatPanel and DmPanel. ChatPanel enables it only when you can post.
- Pasted images named `image.png` (Chrome's generic name) are renamed too, not just nameless ones.
- Added beyond the packet: while a chat panel is showing, a file dropped elsewhere in the window (sidebar, member list) is swallowed rather than letting the browser navigate to the file and away from the app.
- Tests were written first for each piece and seen failing.

## Not verified
- A real drag from the OS file manager and a real Ctrl+V of a screenshot (simulated with real browser events and real files).
- Firefox / Safari.
