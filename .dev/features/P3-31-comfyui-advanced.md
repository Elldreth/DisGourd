# P3-31 — ComfyUI advanced settings (sampler, CFG, steps, negative, face detailer)

- **Unit Type:** Implementation
- **Phase:** 3
- **State:** REVIEW
- **Effort:** M
- **Depends on:** P3-24 / P3-28 / P3-29 (engine and Settings). Branched from P3-30 (#138), itself on P3-29 (#137); merge after both.
- **Requirement Source:** the user, 2026-10-18: "an advanced settings accordion that gives specific settings for image generation for the sampler and the other settings (CFG, steps, face detailer/adetailer)". Decisions (user, 2026-10-18):
  - **Host only**, in Settings → Image generation → ComfyUI; people in chat keep Shape / Quality.
  - **Settings:** sampler, scheduler, CFG, steps per quality, negative prompt, face detailer.
  - **Face detailer on Standard and High** (after the hires fix on High); Draft stays quick.

## Scope
- **Listing:** `samplers` and `schedulers` from this ComfyUI's KSampler; `detectors` (UltralyticsDetectorProvider `model_name`, with `suggested.detector` picked by name: face_yolov8m, then any face model); `detailerAvailable` = FaceDetailer and UltralyticsDetectorProvider both exist (the Impact Pack). Missing nodes mean empty lists, false and null.
- **Config** (each blank keeps the model type's tuned default):
  - `sampler` and `scheduler`: a name up to 100 characters (ComfyUI checks it's real; a refusal names it);
  - `cfgScale`: 0–30;
  - `steps`: `{ draft, standard, high }`, each 1–150;
  - `negative`: up to 1000 characters;
  - `detailer` (on/off), `detector` and `detailerDenoise` (0.1–0.8, default 0.4).
- **Workflow:**
  - The overrides apply to the first pass, the hires repaint (which uses Standard's steps) and the tiled upscale (which uses Standard's steps and the same sampler / scheduler / CFG).
  - **Negative:** the host's negative replaces the built-in quality words. The safety words outside 18+ channels are still added for SD 1.5 / SDXL. Flux and Z-Image get the host's negative only if one is set; at CFG 1 they ignore it.
  - **Face detailer** (Standard and High, when on and a detector is known):
    - UltralyticsDetectorProvider (40) → FaceDetailer (41), fed the final image (8, or 25 after the hires fix) with the same model, clip, vae, prompt conditioning, seed, sampler, scheduler and CFG, Standard's steps and the host's denoise;
    - guide size 512 for SD 1.5, 1024 otherwise;
    - PreviewImage takes FaceDetailer's first output.
  - The Upscale button's workflows are unchanged.
- **Settings:** an "Advanced" accordion (`<details>`) under the ComfyUI card with the fields above, each blank meaning "Default (…)" with the default shown; the detailer section is greyed out with a note when the Impact Pack is missing.

## Acceptance criteria
- [x] Engine: the overrides land in KSampler 3, the hires 24 and the tiled 30; blanks keep the defaults; the negative rules hold for each family and 18+; the face detailer nodes and wiring are right on Standard and High, after hires, absent on Draft, when off or with no detector; validation covers each field; the listing returns the samplers, schedulers, detectors, suggestion and availability (false without the nodes).
- [x] Web: the accordion starts closed; the dropdowns come from the test; blanks are sent as null; the detailer is disabled without the Impact Pack; the values are saved.
- [x] All suites pass; `vite build` is clean.
- [x] Live on the user's ComfyUI: a Standard image with the face detailer on (and a custom sampler / steps) runs and comes back.

## Discovered Work
- (none yet)
