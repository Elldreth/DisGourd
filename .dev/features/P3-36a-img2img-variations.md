# P3-36a — Subtle / Strong Variations (img2img) and a stronger face detailer

- **Unit Type:** Implementation (child of P3-36)
- **Phase:** 3
- **State:** REVIEW
- **Effort:** M
- **Starting baseline:** main at 637ead4 (#147 merged)

## Scope
- **Server:**
  - **The `imagine` op:** `{ from, vary: 'subtle' | 'strong' }` makes a variation of that finished image (strength 0.35 / 0.6). It works on a generated, varied or upscaled image, from either engine. The source image is read from uploads, and the job runs on ComfyUI (otherwise `NO_ENGINE`). It uses the source job's prompt, shape and quality.
  - **Usual rules:** the prompt check, the daily limit (it counts), permissions and posting rights all apply.
  - **Retry** of a failed variation repeats it from the same image and strength.
- **Migration v19:** `imagine_jobs.strength`. Job kind `vary` with `source_url`.
- **Runner text:**
  - while working: "🎲 Varying for **name**…";
  - done: "🎲 **name** varied (subtle | strong): prompt".
- **Engine:**
  - **The image:** `request.init = { buffer, ext, contentType, denoise }` is uploaded. The first pass then starts from it, LoadImage → ImageScale (to the size for the shape / quality / tier, centre crop) → VAEEncode, with KSampler denoise = strength, in place of the empty latent. The hires fix and face detailer then apply as usual.
  - **A custom workflow** makes a new take (text-to-image) for now; image-to-image workflows come in P3-36b.
- **Chat:**
  - Finished images (generated, varied or upscaled) get "🎲 Subtle variation" and "🎲 Strong variation" buttons when ComfyUI is on (`canVary`), replacing the old Variations button. Without ComfyUI, a single "🎲 Variations" (a new take) stays as before.
  - Failed ones keep Retry.
- **Face detailer:**
  - `max_size` follows the VRAM tier: 1024 / 1536 / 2048;
  - `bbox_crop_factor` 2 (was 3);
  - SD 1.5 keeps guide 512 with max 768.

## Acceptance criteria
- [x] Server: subtle / strong variations queue a `vary` job with strength and source_url, counted, posted for the presser. Varying an upscaled image works. Refused: a running or failed generate job (`NOT_FOUND`), ComfyUI off (`NO_ENGINE`). A failed variation retries as a variation with the same strength.
- [x] Engine: the img2img workflow wiring (LoadImage → ImageScale → VAEEncode → KSampler denoise, no empty latent), with hires and detailer still applied; the detailer's max_size by tier, crop factor 2.
- [x] Web: Subtle / Strong buttons on generated, varied and upscaled images when `canVary`; a single Variations without it; the presses send `{ from, vary }`.
- [x] All suites pass; `vite build` is clean.
- [x] Live on the user's ComfyUI: subtle and strong variations of a real image look close / looser; the detailer before/after on a High image shows a visibly bigger change than before.

## Implementation notes
- **Strengths:** `VARY = { subtle: 0.35, strong: 0.6 }`. `readUpload(url)` now serves both upscales and variations.
- **The run:** the variation runs on ComfyUI whichever engine made the source image. The job keeps the source's prompt, shape and quality, and the source image is scaled to the size the request would have (centre crop, so a different aspect ratio is cropped rather than squashed).
- **With a custom workflow** a variation is a text-to-image new take until P3-36b adds an image-to-image workflow box.
- **Chat:** with `canVary`, the two buttons replace the single Variations on generated, varied and upscaled images. Upscale 2× stays on generated and varied ones. Without ComfyUI, the old Variations (new take) remains.

## Evidence (2026-10-19)
| Acceptance criterion | Evidence |
|---|---|
| Detailer investigation | ComfyUI history: every High job since the detailer was switched on ran FaceDetailer (40 / 41, saved from 41) with no errors. A detection-only run on the user's two latest images found 1 face with all three face detectors at 0.5, 0.3 and 0.2. Before / after on the user's exact High setup (1280×1856, 3 passes, 0.3): mean change 6.81 in the face region, a slight change, because the ~900 px crop was barely enlarged under max_size 1024 |
| Server | `imagine-comfyui.test.js` (35, 3 new): `canVary`. A kie.ai-made image varied subtly → job vary / comfyui / strength 0.35 / source_url / same prompt and shape, counted; denoise 0.35 sent; the uploaded `disgourd-vary-…` image fed to LoadImage; message "🎲 **admin** varied (subtle): …". Strong from the variation → 0.6. An upscaled image can be varied. A failed variation retries as a variation at 0.6 from the same image. A failed generate → NOT_FOUND; ComfyUI off → NO_ENGINE. Engine: nodes 1 LoadImage → 2 ImageScale (the size of the hires first pass, centre) → 5 VAEEncode → 3 denoise 0.35 / latent 5; hires 24 and detailer 41 (from 25, max 1536 at medium, crop 2) still applied; Flux encodes with VAE 13; without an image, EmptyLatentImage and denoise 1; max_size by tier 1024 / 1536 / 2048, SD 1.5 512 / 768. All server suites: 361 |
| Web | `ImagineAgain.test.jsx` (6, 2 new): the `varied` kind (and not for "wild"); with canVary, Subtle / Strong on generated, upscaled and varied images (3 each), no single Variations, Upscale on generated and varied only (2), Retry on the failure; presses send `{ from: 1, vary: 'subtle' }` and `{ from: 6, vary: 'strong' }`; without canVary the single Variations stays. Web suites: 76 files, 645; `vite build` clean |
| Live (user's ComfyUI) | Detailer after the fix, the same High setup and seed: max_size 2048, crop 2 → mean change 12.57 (about double), with visibly crisper eyes, lashes and line work. Variations of the 1024² gourd image (the user's SDXL model): subtle (0.35) 4.2 s keeps the picture and touches it up; strong (0.6) 3.9 s keeps the layout and redraws the face, hair and details. Sandbox restarted on this branch (v19): Tx Check `canVary` true, and the latest image shows Subtle variation / Strong variation / Upscale 2× |
