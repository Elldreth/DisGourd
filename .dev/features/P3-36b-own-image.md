# P3-36b — Start /imagine from your own picture; image-to-image custom workflow

- **Unit Type:** Implementation (child of P3-36)
- **Phase:** 3
- **State:** REVIEW
- **Effort:** M
- **Starting baseline:** main at c047130 (#148 merged)
- **Requirement Source:** P3-36 (user, 2026-10-19): "Start from an image" in the /imagine panel, attaching a picture or using the one you're replying to, with a strength choice; ComfyUI first; an image-to-image box for custom-workflow hosts.

## Scope
- **Server:** the `imagine` op takes `init: { url | messageId, strength: 'subtle' | 'medium' | 'strong' }`.
  - **`url`:** one of our `/uploads` images. `readUpload` now accepts people's file names (spaces etc.), but only a plain name inside its own upload folder (no `..`, no leading dot) and only PNG / JPEG / WebP.
  - **`messageId`:** a message in this very channel; its first picture is used.
  - **Strength:** Subtle / Strong are the host's variation strengths; Medium is halfway between them.
  - **Shape:** taken from the picture's proportions (wide ≥ 1.6, landscape ≥ 1.2, portrait ≤ 0.83, else square).
  - **The job:** kind `img2img`, with `source_url` and `strength`. It runs on ComfyUI (otherwise `NO_ENGINE`) through the same img2img loopback as Variations (P3-36a), and is counted. Retry of a failed one repeats it.
  - **Refused:** a bad strength (`BAD_OPTION`); no usable picture, another channel's message, or a path outside uploads (`NOT_FOUND`).
- **Custom workflows:** an optional "Image-to-image workflow" box. Placeholders: those of the main workflow plus `{{image}}` (required) and `{{denoise}}` (a number). It's checked on save like the others. Variations and "Start from a picture" use it; without it, the built-in img2img runs.
- **App:**
  - **The panel:** with ComfyUI available (`canVary`), the /imagine panel has "🖼️ Start from a picture" (uploads the file).
  - **Replying:** when you're replying to a message with a picture, the panel uses that picture ("From the picture you're replying to"), with ✕ to stop using it.
  - **Choices:** strength chips Subtle / Medium / Strong; the Shape chips are hidden ("The shape follows the picture").
  - **After sending:** the picture is cleared, and the reply bar closes if its picture was used.
- **Replies:** ChatPanel / ThreadPanel pass the replied message's first picture.

## Acceptance criteria
- [x] Server: from an upload (with a spaced name) → img2img job with Medium 0.48 (halfway between the host's 0.3 / 0.65), landscape shape from a 1200×800 picture, counted, denoise sent, the image uploaded to ComfyUI; from a replied message → strong 0.65; refusals; a retry repeats it; without ComfyUI → NO_ENGINE. The custom img2img workflow fills `{{image}}` and numeric `{{denoise}}`; without one, the built-in img2img runs; the box is checked like the others.
- [x] Web: attach → its name shown, no Shape chips, Strong → `init: { url, strength: 'strong' }` with no shape; cleared after sending; replying → `init: { messageId, strength: 'medium' }` and the reply closes; ✕ → a normal request with a shape; no picture option without canVary. Settings: the Image-to-image box with `{{denoise}}` help is saved.
- [x] All suites pass; `vite build` is clean.
- [x] Live: replying to an image with /imagine starts from it.

## Evidence (2026-10-19)
| Acceptance criterion | Evidence |
|---|---|
| Server | `imagine-comfyui.test.js` (37, 2 new): "My Photo.png" (1200×800) via `/uploads/<t>/My%20Photo.png`, medium → `{ kind: img2img, engine: comfyui, strength: 0.48, shape: landscape }`, count +1, denoise 0.48, LoadImage `disgourd-vary-…`; replied message → strong 0.65; refusals 'max' → BAD_OPTION, a text-only message / another channel / `..%2F..%2Fsecret.png` → NOT_FOUND; failed → retry kind img2img 0.65, same source and prompt; ComfyUI off → NO_ENGINE. Custom: `{{image}}` = the uploaded name, `{{denoise}}` 0.45 (a number); no img2img workflow → built-in (ImageScale, 0.45); a box without `{{image}}` refused "Image-to-image workflow: …". Server suites: 363 (stable over three runs; one earlier run showed 13 imagine.test failures that didn't reproduce) |
| Web | `Composer.imagine.test.jsx` (12, 3 new) as listed; `ImagineAdmin.test.jsx` (17, 1 new). Web suites: 76 files, 650; `vite build` clean |
| Live (user's ComfyUI, sandbox restarted on this branch) | Tx Check #random: replied to the lighthouse image (msg 907) and typed "/imagine a watercolor painting of the scene" → the panel showed "From the picture you’re replying to" with its thumbnail and Subtle / Medium / Strong. Enter → msg 930, job 72 `{ kind: img2img, engine: comfyui, strength: 0.48, shape: square, status: done }` from the lighthouse; the result keeps the scene (lighthouse, cliffs, sunset) and redraws it, adding a figure and stars. The custom image-to-image box was checked through tests, not live |
