# P3-32 — Update notice behind dialogs; date/time image names

- **Unit Type:** Implementation
- **Phase:** 3
- **State:** COMPLETE (merged #140)
- **Effort:** XS
- **Depends on:** P3-19 (top notice), P2-20 (saved images)
- **Starting baseline:** main at ba1fd6f (#139 merged)
- **Requirement Source:** the two findings noted in P3-30 / P3-31; the user's choices (2026-10-18):
  - "Go behind dialogs" for the "A new version of DisGourd is ready" notice.
  - "DisGourd + date/time" for /imagine file names (the prompt left out on purpose).

## Scope
- **`Toasts`:** the top row (only the update notice uses it) moves from z-60 to z-45. It's below dialogs, menus and the image viewer (z-50), still above the phone member and thread panels (z-40). The bottom row's quick notices ("Message deleted · Undo", errors) stay at z-60, above dialogs.
- **`runner.saveImages(images, { kind, now })`:** names are `disgourd-YYYY-MM-DD-HHMMSS.<ext>` in the server's local time, with `-2`, `-3`… for extra images in one request and `-upscaled` for an upscale. Each request still gets its own random folder, so names never clash. Images already saved keep their names.

## Acceptance criteria
- [x] Server: a chat image's URL ends in `disgourd-<date>-<time>.png`; `fileStamp` and `saveImages` give the exact names for one image, extra images and an upscale; an upscale through ComfyUI is named `-upscaled`.
- [x] Web: the top row is z-45 and the bottom row z-60.
- [x] All suites pass; `vite build` is clean (and has `.z-45{z-index:45}`).
- [x] Sandbox: with the notice showing, the image viewer covers it and it's back on top once closed; a new image downloads as `disgourd-….png`.

## Evidence (2026-10-18)
| Acceptance criterion | Evidence |
|---|---|
| Server | `imagine.test.js` (13, 1 new): the done attachment matches `/uploads/<hex>/disgourd-\d{4}-\d{2}-\d{2}-\d{6}.png`; for 2026-10-08 07:05:03, `fileStamp` = `2026-10-08-070503`, two images give `disgourd-2026-10-08-070503.png` and `…-2.jpg` in one folder, and an upscale gives `…-upscaled.png`. `imagine-comfyui.test.js`: the Upscale button's result ends in `-upscaled.png` |
| Web | `Toasts.test.jsx` (7, 1 new): top `z-45`, bottom `z-60` |
| Suites | Server: 337 tests. Web: 74 files, 621 tests. `vite build` clean, CSS has `.z-45{z-index:45}` |
| Sandbox | Restarted on this branch; the "A new version of DisGourd is ready" notice was showing. sandy sent "/imagine a lighthouse on a cliff at sunset": `/uploads/3d0e…/disgourd-2026-10-18-181243.png`, and the viewer's Download is `disgourd-2026-10-18-181243.png`. With the viewer open, the point at the notice's centre belongs to the dialog (computed z 45); after Esc, the notice is on top again. Screenshot: the viewer with no notice over it |
