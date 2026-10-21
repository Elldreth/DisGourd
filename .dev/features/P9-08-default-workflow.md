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
5. **The face detailer (Standard and High):**
   - Find faces (bbox detector).
   - Each face's crop (twice the face) is scaled to exactly **1024 px**: `guide_size_for` the crop region, guide and max size both 1024, for any face size.
   - Repaint at **denoise 0.3**. Each pass feeds its result into the next (FaceDetailer's `cycle` re-samples the previous pass's output), so the face changes a bit more each pass. Passes come from Settings (1–5; the owner uses 3).
   - The finished crop goes back into the image. The detailer runs last; nothing repaints after it.
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
