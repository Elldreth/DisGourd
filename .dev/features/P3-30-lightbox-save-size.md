# P3-30 — Image viewer: right-click to save, real size, Download

- **Unit Type:** Implementation
- **Phase:** 3
- **State:** COMPLETE (merged #138)
- **Effort:** S
- **Depends on:** none. Branched from P3-29 (#137) only to keep INDEX.md conflict-free; merge after it.
- **Requirement Source:** the user, 2026-10-18: "I can't save the image because there are no options to do so and when I right click it in the lightbox the message menu pops up in the background. So, I have no way to see if the image is the same size or if it is upscaled."

## Cause
The viewer (Lightbox → Modal) is a React portal rendered inside the message row. React passes portal events up the component tree, so a right-click or touch press on the viewer's image reached the row's `onContextMenu` / `onPointerDown`. The row opened its message menu and called `preventDefault`, which also suppressed the browser's own "Save image as" menu.

## Scope
- **`MessageRow`:** the context menu and the long-press now act only on events from the row's own area on the page (`rowRef.contains(e.target)`). Its key handler already only acted on keys aimed at the row itself.
  - First tried: stopping events at the Modal backdrop. Dropped, because it also stopped native keydown reaching `window`, which broke the viewer's ← → keys (caught by the existing Lightbox test).
- **`Lightbox`**, a bar under the media:
  - the file name;
  - its real size once loaded ("2048 × 2048", read as "2048 by 2048 pixels"; videos use `videoWidth` / `videoHeight`);
  - **Download** (`<a download>`);
  - **Open original** (a new tab, `noopener`).
- **`Icon`:** `download` and `external`.

## Acceptance criteria
- [x] Web: right-clicking the viewer's image isn't prevented and opens no message menu, while right-clicking the message still does (shown failing without the fix); the size appears after load; the Download and Open original links have the right attributes.
- [x] All web tests pass; `vite build` is clean.
- [x] Sandbox: the original and upscaled gourd show different sizes in the viewer; right-click on the viewer's image is left to the browser.

## Evidence (2026-10-18)
| Acceptance criterion | Evidence |
|---|---|
| Web | `Lightbox.test.jsx` (5, 2 new). In a real MessageList: open the image, right-click the viewer's image → `fireEvent` returns true (not prevented) and there's no `role=menu`. Right-clicking the row → prevented (its menu). Without the MessageList change this test fails. After `load` with naturalWidth 2048 × naturalHeight 1536, "2048 × 1536" is labelled "2048 by 1536 pixels"; Download has `href` and `download="one.png"`; Open original has `target=_blank rel=noopener noreferrer` |
| Suites | Web: 74 files, 618 tests. `vite build` clean |
| Sandbox | Tx Check #random, sandy. Msg 886 (original): the viewer shows "1024 × 1024"; msg 887 (upscaled): "2048 × 2048". Both have Download / Open original. A `contextmenu` on the viewer's image was not prevented and no message menu opened. Screenshot: the image with "2048 × 2048 · Download · Open original" below it |

## Discovered Work
- The "A new version of DisGourd is ready" notice sits above the image viewer, covering the top of the image. Small, and not changed here.
- Downloaded /imagine files are all named `imagine-1.png`; a name from the prompt (and "-upscaled") would be friendlier.
