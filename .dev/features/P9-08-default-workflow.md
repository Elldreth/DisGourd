# P9-08 — A better built-in ComfyUI workflow

- **Unit Type:** Implementation
- **Phase:** 9
- **State:** READY (once this plan merges)
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

## Acceptance criteria
- [ ] **Server tests** on the built graphs:
  - **SDXL High:** CLIP skip −2 feeding the encoders; a 1024×1536 first pass with 15 steps, CFG 5, dpmpp_2m / karras; hires to 1368×2048 with 15 steps at 0.45; FaceDetailer with the owner's values plus SAM and `cycle` = passes; Color Match from the base image to the detailer output; saving from Color Match.
  - **Standard:** no hires; detailer and Color Match on the first pass.
  - **Draft:** 10 steps, nothing else.
  - **Tiers** cap the hires size; **CLIP skip 1** removes the node; **saved overrides** win; other families unaffected apart from the detailer and Color Match.
  - **Tiled Upscale:** the owner's USDU values, Color Match to the source image, saturation 1.15, then save.
  - **Variations:** a Color Match to the source after each loop.
  - **Missing optional nodes:** the step is left out, with a note.
- [ ] **Web:** the new Advanced fields (CLIP skip, Hires steps) and Quality's Hires strength save and load; the defaults shown in Settings match.
- [ ] **All suites pass;** `vite build` is clean.
- [ ] **Live, on the owner's ComfyUI:**
  - the witch prompt and seed, old vs new at High, compared side by side (full image and face), with times;
  - a tiled Upscale of the new image (about 4K), with time;
  - a Subtle variation whose colors hold.
