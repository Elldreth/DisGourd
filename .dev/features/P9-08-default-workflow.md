# P9-08 — A better built-in ComfyUI workflow

- **Unit Type:** Implementation
- **Phase:** 9
- **State:** READY (once this plan merges)
- **Effort:** M (no migration)
- **Depends on:** P3-28 (hires fix), P3-31 / P3-33 (face detailer and passes), P9-04 (styles)

## Why
Faces in full-body images come out barely touched. The detailer enlarges a small face's crop about 6× to 2048 px, repaints it lightly at 0.4, then shrinks it back down, so it mostly tidies the face (2026-10-20 comparison on the owner's witch image: it fixed a mismatched eye but didn't redraw the face). The owner set out a standard, better default.

## The new built-in workflow (owner, 2026-10-20)
For SDXL-family checkpoints (SDXL, Illustrious, Pony, Noob). Other families keep their own tuned values, but get the same detailer change.

1. **Load the model(s).**
2. **CLIP skip 2:** `CLIPSetLastLayer` at −2 between the checkpoint's CLIP and both prompt encoders (and the detailer). A per-style **CLIP skip** setting in Advanced (1 or 2) can turn it off; the default is 2 for the SDXL family.
3. **The first pass:** an empty latent at about **1.5 MP with a 1024 short edge** (portrait 1024×1536, square 1216×1216, landscape 1536×1024, wide 1792×1024 or close, multiples of 64). `KSampler` with **15 steps, CFG 5, dpmpp_2m / karras**.
4. **The hires fix (High only):**
   - Enlarge with the upscale model, then resize to **3K on the long edge** (portrait 2048×3072, about 2× each side).
   - Then **15 steps at denoise 0.45**, the same sampler, CFG and seed.
5. **The face detailer (Standard and High)**, matching the owner's own ComfyUI setup (screenshot, 2026-10-20):
   - **Finding faces:**
     - `UltralyticsDetectorProvider` with the detector from Settings, suggesting **`bbox/face_yolov8m.pt`** when present.
     - Plus **`SAMLoader`** (`sam_vit_b_01ec64.pth`, device AUTO) into FaceDetailer's `sam_model_opt`, so the mask follows the face's outline instead of a box.
   - **FaceDetailer:**
     - guide_size **1024**, guide_size_for **bbox**, max_size **1024**;
     - steps **30**, CFG **5**, sampler **ddim**, scheduler **simple**;
     - denoise **0.30**, feather 5, noise_mask and force_inpaint on;
     - bbox_threshold 0.5, bbox_dilation 10, bbox_crop_factor **3.0**;
     - sam_detection_hint center-1, sam_dilation 0, sam_threshold 0.93, sam_bbox_expansion 0, sam_mask_hint_threshold 0.7, sam_mask_hint_use_negative False;
     - drop_size 10;
     - **cycle** = passes from Settings. Each cycle re-samples the previous one's result, which is the owner's "feed the face back in" loop.
   - **Color Match** (KJNodes `ColorMatch`, method **hm-mvgd-hm**, multithread on) afterwards. `image_ref` is the image before the detailer and `image_target` the detailer's output, so the repainted face keeps the image's colors.
   - **When something's missing** on a host's ComfyUI (SAM loader or model, KJNodes), the detailer runs without that piece, and the server log notes it, as it already does for other optional nodes.
   - The detailer runs last; nothing repaints after it.
6. **Save.**

### Qualities
- **High:** steps 1–6: 15 + 15 hires steps, then the detailer.
- **Standard:** the 15-step first pass at the same size, then the detailer; no hires.
- **Draft:** the first pass only, at about 1 MP and 10 steps.

### Graphics memory tiers
They cap the hires size:
- **High** (24 GB+, e.g. RTX 5090): 3K long edge, as above.
- **Medium:** 2K long edge.
- **Low:** 1.5K long edge, with a first pass of about 1 MP.

## Defaults and settings
- **The SDXL family's built-in defaults become:**
  - steps 10 / 15 / 15 (Draft / Standard / High), plus hires steps 15;
  - CFG 5, dpmpp_2m / karras;
  - hires denoise 0.45; detailer denoise 0.3.
- **Saved values still win.** Anything set in a style's Advanced (steps, CFG, sampler) or in Quality (detailer strength, passes) stays as saved. The owner's current detailer strength (0.4) will need setting to 0.3, or clearing, after this ships. The PR says so.
- **New settings:**
  - per style, **CLIP skip** (Advanced) and **Hires steps** (Advanced, beside the step counts);
  - shared, **Hires strength** (Quality, beside the hires fix switch; default 0.45).
- **The detailer's own sampling** (30 steps, CFG 5, ddim / simple, crop factor 3) is built in, separate from the style's. Strength and passes stay in Settings.

## Out of scope (recorded)
- **The Upscale button's tiled mode** repaints the whole image at 0.3 after the detailer, softening faces again. A follow-up could re-run the detailer after tiled upscaling.
- **Hands or eyes passes**, and other detector models.

## Acceptance criteria
- [ ] **Server tests** on the built graph:
  - **SDXL High:** `CLIPSetLastLayer` −2 feeding both encoders and the detailer; a 1024×1536 first pass with 15 steps, CFG 5, dpmpp_2m / karras; hires to 2048×3072 with 15 steps at 0.45; FaceDetailer with crop guide 1024 / max 1024 and `guide_size_for` the crop, denoise 0.3, `cycle` = passes, saving from the detailer.
  - **Standard:** no hires, with the detailer.
  - **Draft:** no hires and no detailer, 10 steps.
  - **Tiers** cap the hires size; **CLIP skip 1** removes the node; **saved overrides** win; **Flux / SD1.5** unaffected apart from the detailer crop.
- [ ] **Web:** the new Advanced fields (CLIP skip, Hires steps) and Quality's Hires strength save and load.
- [ ] **All suites pass;** `vite build` is clean.
- [ ] **Live, on the owner's ComfyUI:** the witch prompt and seed, old vs new, compared side by side (full image and face), with times. The face should be visibly redrawn.
