# P3-29 — Upscale button on /imagine images

- **Unit Type:** Implementation
- **Phase:** 3
- **State:** COMPLETE (merged #137)
- **Effort:** M
- **Depends on:** P3-23 (Retry/Variations, `from`), P3-24 / P3-28 (ComfyUI parts, upscale model)
- **Starting baseline:** main at 784b8a6 (#136 merged)
- **Requirement Source:** the user, 2026-10-18: upscale should be either a tiled upscale using an upscale model, or just an upscale model untiled; they like tiled for larger images but it may need tuning. Decisions (user, 2026-10-18):
  - **Both modes, the host picks** in Settings: "Upscale model only" (the default; no tuning) or "Tiled repaint" (Ultimate SD Upscale, with denoise and tile size). Tiled is offered only when the host's ComfyUI has the `UltimateSDUpscale` node.
  - **One "Upscale 2×" button.** The longest side is capped at 4096 px; already-upscaled images don't offer it.
  - **Like Variations:** anyone who may use /imagine there can press it; it counts as one image toward the presser's daily limit and is posted under their name.

## Scope
- **Migration v16:** `imagine_jobs.kind` ('generate' | 'upscale', default 'generate') and `imagine_jobs.source_url`, the image an upscale started from.
- **Server, `imagine` op `{ from, upscale: true }`:**
  - The source job must be a finished image in this channel. That covers an image from either engine; an upscaled one is refused.
  - Upscaling runs on ComfyUI, which must be on with an upscale model. Otherwise it's refused with `NO_ENGINE`: "Upscaling needs ComfyUI with an upscale model (Settings → Image generation)".
  - The factor is min(2, 4096 / longest side). Below 1.25 it's refused with `TOO_BIG`.
  - The usual checks apply (posting rights, server switch, permission, limit).
  - A Retry of a failed upscale upscales again from `source_url`; Variations on an upscaled image makes a new image from its prompt.
- **ComfyUI engine, `request.upscale = { buffer, filename, width, height, factor }`:**
  - The image is uploaded with `POST /upload/image` as `disgourd-upscale-<random>.<ext>`.
  - **Model only:** LoadImage → UpscaleModelLoader → ImageUpscaleWithModel (ComfyUI tiles this internally) → ImageScale (lanczos) to the exact size → PreviewImage.
  - **Tiled repaint:** LoadImage → UltimateSDUpscale, using the configured model (checkpoint or parts) with the prompt, upscale model, `upscale_by` = factor, the family's Standard steps / cfg / sampler / scheduler, the host's denoise (default 0.3) and tile size (default 1024), Linear mode, no seam fix and uniform tiles.
- **Settings:** the "Upscale model" picker serves both the hires fix and the button. "Upscale button: Upscale model only / Tiled repaint", with Tiled disabled and a note when the node is missing. For Tiled: denoise (0.05–0.6) and tile size (512–2048).
- **Chat:**
  - "🔍 Upscale 2×" next to Variations on finished images, when this server's `imagine.canUpscale` is true.
  - The result: "🔍 **name** upscaled: prompt", which gets Variations only.

- **Fix for P3-28 (user, 2026-10-18: "I can't tell if hires fix is actually doing anything").** The hires fix only fired once an upscale model had been saved, so an install that upgraded did nothing at High until Settings was saved again. Now, when no upscale model is saved, the engine asks ComfyUI for its list and uses the name-based suggestion (cached per address for 10 minutes). The Upscale button uses the same fallback. (The user's sandbox was also running pre-#136 server code, which ignored the hires settings entirely.)

## Acceptance criteria
- [x] Hires fix with no saved upscale model: the suggested one is used (listing fetched once, then cached); none on that ComfyUI means no fix, as before.
- [x] Server: an upscale from another's image queues a job (kind upscale, source_url, counted for the presser), uploads the image and posts "🔍 … upscaled: …" at 2× size. The cap makes 3072² → 4096² and refuses 4096². Refused: an upscaled image, a failed or running job, another channel, ComfyUI off or with no upscale model. Retry of a failed upscale upscales again. `canUpscale` in GET /spaces.
- [x] Engine: the model-only and tiled workflows (nodes and wiring, with Flux parts in tiled), the upload request, and validation of the mode, denoise and tile size; `tiledAvailable` in the listing.
- [x] Web: the Upscale button appears only with `canUpscale` and only on generated (not upscaled) images, and presses `run({ from, upscale: true })`; Settings mode, denoise and tile size are saved; Tiled is disabled without the node.
- [x] All suites pass; `vite build` is clean.
- [x] Live on the user's ComfyUI: an upscale in each mode from a real image.

## Discovered Work
- (none yet)
