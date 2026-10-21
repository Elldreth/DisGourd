# P9-08 — A better built-in ComfyUI workflow

- **Unit Type:** Implementation
- **Phase:** 9
- **State:** COMPLETE (#197)
- **Starting baseline:** main at b5afadc (#196 merged)
- **Effort:** M (no migration)
- **Depends on:** P3-28 (hires fix), P3-29 / P3-32 (Upscale, tiled mode), P3-31 / P3-33 (face detailer and passes), P3-36a (Variations), P9-04 (styles)

## Why
Faces in full-body images come out barely touched. Today the detailer enlarges a small face's crop about 6× to 2048 px, repaints it lightly at 0.4, then shrinks it back down. On the owner's witch image (2026-10-20 comparison) it fixed a mismatched eye but didn't redraw the face. The owner's own ComfyUI workflow does better, and this unit makes DisGourd's built-in workflow follow it (screenshots of its Phase 4 and Phase 5 nodes, 2026-10-20).

## The workflow (SDXL-family checkpoints: SDXL, Illustrious, Pony, Noob)

### /imagine at High
1. **Load the model.**
2. **CLIP skip 2:** `CLIPSetLastLayer` at −2 between the checkpoint's CLIP and the prompt encoders (and everything that encodes later). A per-style **CLIP skip** setting in Advanced (1 or 2) can turn it off; the default is 2 for this family.
3. **The base image:** an empty latent with a **1024 short edge** (portrait 1024×1536, square 1216×1216, landscape 1536×1024, wide 1792×1024, multiples of 8). `KSampler` with **15 steps, CFG 5, dpmpp_2m / karras**. This is "the original generated image".
4. **The hires fix:**
   - Enlarge with the upscale model, then resize to **2048 on the long edge** (portrait 1368×2048).
   - Then **15 steps at denoise 0.45**, the same sampler, CFG and seed.
5. **The face detailer**, set up like the owner's Phase 4:
   - **Finding faces:**
     - `UltralyticsDetectorProvider` with the detector from Settings, suggesting **`bbox/face_yolov8m.pt`** when present.
     - Plus **`SAMLoader`** (`sam_vit_b_01ec64.pth`, device AUTO) into `sam_model_opt`.
   - **FaceDetailer:**
     - guide_size **1024**, guide_size_for **bbox**, max_size **1024**;
     - steps **30**, CFG **5**, **ddim / simple**;
     - denoise **0.30** (the Settings strength), feather 5, noise_mask and force_inpaint on;
     - bbox_threshold 0.5, bbox_dilation 10, bbox_crop_factor **3.0**;
     - sam_detection_hint center-1, sam_dilation 0, sam_threshold 0.93, sam_bbox_expansion 0, sam_mask_hint_threshold 0.7, sam_mask_hint_use_negative False;
     - drop_size 10;
     - **cycle** = passes from Settings, **default 3** (was 1). Each cycle re-samples the previous one's result.
6. **Color Match** (KJNodes `ColorMatch`, **hm-mvgd-hm**, multithread on): `image_ref` = **the original generated image** (step 3), `image_target` = the detailer's output.
7. **Save.** High stops here: about 1368×2048, the detailed image.

### The other qualities
- **Standard:** steps 1–3, then 5–7 on the base image (no hires).
- **Draft:** steps 1–3 only, at about 1 MP and 10 steps.

### The Upscale button (the owner's Phase 5; tiled mode)
1. **Ultimate SD Upscale 2×:**
   - the upscale model from Settings (the owner uses 4x-AnimeSharp);
   - steps **30**, CFG **6**, **ddim / simple**, denoise **0.20**;
   - mode Linear, tiles **1280×1280**, mask_blur **16**, tile_padding **64**;
   - seam fix None, force_uniform_tiles on, tiled_decode off.
2. **Color Match** (hm-mvgd-hm): `image_ref` = the image being upscaled (the posted one), `image_target` = the upscaled one.
3. **Image Filter Adjustments** (WAS Node Suite): saturation **1.15**, everything else neutral (brightness 0, contrast 1, sharpness 1, no blur, no edge or detail enhance).
4. **Save:** about 2736×4096.

The "model only" Upscale mode stays as it is.

### Variations and "Start from a picture" (the loopback)
After each loop (the repaint, then the detailer), a **Color Match** back to the source picture keeps colors from fading over the loops.

### Graphics memory tiers
- **High** (24 GB+, e.g. RTX 5090): as above.
- **Medium:** the base image at about 1 MP, hires to 1792 on the long edge.
- **Low:** the base image at about 1 MP, hires to 1536 on the long edge.
- Tiled Upscale works on any tier (it's tiled).

## Optional pieces
SAM (Impact Pack's SAMLoader and the sam_vit_b model), KJNodes (Color Match) and WAS Node Suite (Image Filter Adjustments) may be missing on someone's ComfyUI. Each step is then left out and the server log notes it, as already happens for other optional nodes.

## Defaults and settings
- **The SDXL family's built-in defaults become:**
  - steps 10 / 15 / 15 (Draft / Standard / High), plus hires steps 15;
  - CFG 5, dpmpp_2m / karras;
  - hires denoise 0.45, detailer denoise 0.3, detailer passes 3;
  - tiled Upscale: denoise 0.2, tile size 1280.
- **The detailer's and the tiled upscale's own sampling is built in, separate from the style's:**
  - detailer: 30 steps, CFG 5, ddim / simple, crop factor 3;
  - tiled upscale: 30 steps, CFG 6, ddim / simple, mask blur 16, padding 64;
  - saturation 1.15.
- **Saved values still win.** Anything set in a style's Advanced (steps, CFG, sampler) or in Quality (detailer strength, passes; tiled denoise, size) stays as saved. The owner's current detailer strength (0.4) will need setting to 0.3, or clearing, after this ships. The PR says so.
- **New settings:**
  - per style, **CLIP skip** and **Hires steps** (Advanced);
  - shared, **Hires strength** (Quality, default 0.45).

## Out of scope (recorded)
- Hands or eyes passes, other detector models, and LoRA switching (the owner's "Want LoRA's?" toggle).

## As built
- **`engines/comfyui.js`:**
  - **SDXL family defaults:** `mp` 1.0, plus `base` sizes for the High tier, steps 10/15/15, `hiresSteps` 15, `clipSkip` 2, CFG 5. `sizeFor` uses `base` on the High tier except at Draft.
  - **Hires:** `hiresLongSize` for the SDXL family enlarges to `HIRES_LONG` (1536 / 1792 / 2048 by tier, multiples of 8); other families keep `hiresSize`. Steps come from `hiresStepsFor`; the strength is `cfg.hiresDenoise ?? 0.45`.
  - **CLIP skip:** `clipSkipFor` (classic-CFG checkpoints only) adds `CLIPSetLastLayer` (node 15) feeding the encoders and the detailer.
  - **Detailer:** `DETAILER` (guide / max 1024, crop 3, 3 passes; for classic-CFG families 30 steps, CFG 5, ddim / simple; others keep their own sampling). SAM (node 42) goes into `sam_model_opt` when found. Denoise defaults to 0.3.
  - **Color Match** (node 43): after the hires fix and / or the detailer, or after a variation's first loop; `image_ref` is the base image (8) or the source picture (1). Each later loop ends in one too (`b+4`).
  - **Tiled upscale:** `TILE` (0.2, 1280, mask blur 16, padding 64; for classic-CFG families 30 steps, CFG 6, ddim / simple), then Color Match (50) to the image being upscaled and `Image Filter Adjustments` (51) at saturation 1.15.
  - **`generate`:** finds the SAM model (`resolveSam`, preferring sam_vit_b; `samCache`). After the tiled fallback check, it leaves out SAM, Color Match or the saturation lift when their nodes are missing, with a note each.
  - **Settings:** style keys `clipSkip` and `hiresSteps`; shared `hiresDenoise`; validation and `publicFlat` (detailer passes default 3, tiled defaults 0.2 / 1280).
- **Web:** `TYPE_DEFAULTS` match (SDXL 10/15/15, CFG 5, hires steps 15, CLIP skip 2). The drafts and Save carry `clipSkip`, `hiresSteps` and `hiresDenoise`. Quality has **Hires strength** (shown with the hires fix on). Advanced has **Hires steps** and **CLIP skip** (checkpoints, SDXL / SD 1.5). The text was updated (hires to 2048; 3 passes, each from the last).
- **Changed from the plan:** Color Match also runs when only the hires fix ran (no detailer), since that repaint can drift colors too.
- **Old tests updated:** about 13 ComfyUI tests and 3 Settings tests asserted the old defaults (1024 base, 36 steps, 0.4 / 2048 detailer, 0.3 / 1024 tiles, the save body); each now states the new value.

## Acceptance criteria
- [x] **Server tests** on the built graphs:
  - **SDXL High:** CLIP skip −2 feeding the encoders; a 1024×1536 base image with 15 steps, CFG 5, dpmpp_2m / karras; hires to 1368×2048 with 15 steps at 0.45; FaceDetailer with the owner's values plus SAM and `cycle` = passes (default 3); Color Match from the base image to the detailer output; saving from Color Match.
  - **Standard:** no hires; detailer and Color Match on the base image.
  - **Draft:** 10 steps, nothing else.
  - **Tiers** cap the hires size; **CLIP skip 1** removes the node; **saved overrides** win; other families unaffected apart from the detailer and Color Match.
  - **Tiled Upscale:** the owner's USDU values, Color Match to the source image, saturation 1.15, then save.
  - **Variations:** a Color Match to the source after each loop.
  - **Missing optional nodes:** the step is left out, with a note.
- [x] **Web:** the new Advanced fields (CLIP skip, Hires steps) and Quality's Hires strength save and load; the defaults shown in Settings match.
- [x] **All suites pass;** `vite build` is clean.
- [x] **Live, on the owner's ComfyUI:**
  - the witch prompt and seed, old vs new at High, compared side by side (full image and face), with times;
  - a tiled Upscale of the new image (about 4K), with time;
  - a Subtle variation whose colors hold.

## Evidence (2026-10-21)
| Acceptance criterion | Evidence |
|---|---|
| Server | `imagine-comfyui.test.js` (+3):<br>• **SDXL High:** node 15 CLIP skip −2 into 6 and 7; 1024×1536 base, 15 steps, CFG 5, dpmpp_2m / karras; hires 1368×2048, 15 at 0.45; SAMLoader (sam_vit_b) into `sam_model_opt`; FaceDetailer with every owner value (guide / max 1024, bbox, crop 3, 30 steps, CFG 5, ddim / simple, 0.3, feather 5, …, cycle 3); Color Match 8→41; save from 43.<br>• **Standard** (no hires, detailer + Color Match); **Draft** (832×1216, 10 steps, nothing else).<br>• **Overrides and families:** CLIP skip 1 drops the node; SD 1.5 off by default and on when set; Flux has no CLIP skip and keeps its own sampling. Saved steps / CFG / sampler / hires steps and strength / detailer strength and passes win. `colorMatch: false` saves from the detailer.<br>• **Settings:** validation, style and shared storage, `publicConfig`.<br>• **Generating:** finds sam_vit_b from the list; with SAM, KJNodes and WAS absent, it leaves each out with the exact notes, and a tiled upscale saves from USDU.<br>Updated older tests: hires sizes per tier (long edge), the tiled Phase 5 nodes (50, 51), the detailer at 1024 on every tier, variation loops ending in Color Match (43, 114, 124), the new defaults |
| Web | `ImagineAdmin.test.jsx`: Advanced shows "Default (15)" / "Default (5)", Hires steps "Default (15)", CLIP skip options; Save sends `hiresSteps: 20`, `clipSkip: 1`; Hires strength shows 0.45 and saves 0.4. The save body includes `clipSkip`, `hiresSteps`, `hiresDenoise` |
| All suites | Server 52 files, 456. Web 103 files, 811. `vite build` clean |
| Live (the owner's ComfyUI, an RTX 5090; the witch prompt, negative and seed from the old image; the owner's model and upscaler; yolov8m + sam_vit_b) | **High:** 1368×2048 in 24 s (the old High took about 48 s). The detailer visibly redraws the face: crisper eyes and line work, a cleaner mouth (`p908-faces.png`, before vs after the detailer on the same render). **Upscale (tiled, Phase 5):** 2736×4096, 18.7 MB, 76 s; the face detail and colors hold. **Subtle variation (2 loops):** 1368×2048 in 30 s; the palette holds (Color Match per loop). The new base size gives a new composition from the same seed. The full image is `new.png` |
