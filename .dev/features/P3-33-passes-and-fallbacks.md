# P3-33 — Passes for the detailer and tiled upscale; missing-node fallbacks

- **Unit Type:** Implementation
- **Phase:** 3
- **State:** REVIEW
- **Effort:** S–M
- **Depends on:** P3-29 (tiled upscale), P3-31 (face detailer). Branched from P3-25a (#142) only to keep INDEX.md conflict-free; merge after it.
- **Requirement Source:** the user, 2026-10-18: detailers "allow a number of loops", and the tiled upscaler should too; "how do we deal with the required nodes if the user doesn't have them installed". Agreed: passes settings, fall back instead of failing, clearer install notes, and no installing nodes on the host's behalf.

## Scope
- **Face detailer passes,** 1–5 (default 1), sent as FaceDetailer's own `cycle`.
- **Tiled passes,** 1–3 (default 1). After UltimateSDUpscale (30), each extra pass is `UltimateSDUpscaleNoUpscale` (31, 32) on the previous output, with the same model, prompt, sampling, denoise and tiles, and seed +1, +2. Offered when that node exists (`tiledPassesAvailable` in the listing).
- **Fallbacks at generate time:** the engine checks the nodes a feature needs (cached per address and node for 10 minutes). If any are missing, it leaves the feature out:
  - face detailer → made without it;
  - tiled → model-only upscale;
  - extra tiled passes → one pass.

  The result carries `notes` (e.g. "made without the face detailer: ComfyUI is missing FaceDetailer"), and the runner logs them.
- **Settings:**
  - the passes fields ("Face detailer passes", "Tiled passes");
  - **install notes** naming the packages: ComfyUI-Impact-Pack + ComfyUI-Impact-Subpack by ltdrdata (the Subpack provides UltralyticsDetectorProvider, as on the user's install) plus a detector such as face_yolov8m.pt in models/ultralytics/bbox, and ComfyUI_UltimateSDUpscale by ssitu, with "ComfyUI Manager can install";
  - **warnings** when a feature is on but its node is missing from this ComfyUI.

## Acceptance criteria
- [x] Engine: cycle = passes (clamped to 5); tiled passes chain 31 / 32 with the right inputs (no image / upscale_model / upscale_by), seeds +1 / +2, save from the last; one pass by default; validation. With the nodes missing, generate leaves out the detailer and tiled (model-only workflow), with the notes; the check is cached; with the nodes back, they're used again.
- [x] Web: the passes are saved; the install notes name the packages; warnings appear when a chosen feature is missing.
- [x] All suites pass; `vite build` is clean.
- [x] Live: a 2-pass face detailer and a 2-pass tiled upscale on the user's ComfyUI.

## Evidence (2026-10-18)
| Acceptance criterion | Evidence |
|---|---|
| Engine | `imagine-comfyui.test.js` (27, 2 new). cycle 3; 99 → 5. Tiled 3 passes: 31 NoUpscale `upscaled_image ['30',0]`, seed 11, denoise 0.25, model / positive / vae as 30; 32 `['31',0]` seed 12; 9 → 32; no node 31 by default. Missing nodes (mock without FaceDetailer / USDU): no node 41, notes `['made without the face detailer: ComfyUI is missing FaceDetailer']`; tiled gives node 22 ImageScale, note 'upscaled with the upscale model only: ComfyUI is missing UltimateSDUpscale'; cached (`has: false`); back on → 41 again. Saved config includes detailerPasses / tilePasses |
| Web | `ImagineAdmin.test.jsx` (12, 1 new): Face detailer passes 3 and Tiled passes 2 saved; the notes read "ComfyUI_UltimateSDUpscale custom node (by ssitu), which ComfyUI Manager can install" and "ComfyUI-Impact-Pack and ComfyUI-Impact-Subpack … face_yolov8m.pt in models/ultralytics/bbox"; with a saved detailer and tiled but a ComfyUI without them, both warnings show |
| Suites | Server: 347 tests. Web: 74 files, 622 tests. `vite build` clean |
| Live (user's ComfyUI) | Listing: tiledAvailable, tiledPassesAvailable and detailerAvailable all true. Face detailer 2 passes, Standard 1216×832: 21.8 s, no notes. Tiled 2 passes, 1024² → 2048²: 83.0 s, no notes. Re-timed with ComfyUI's queue confirmed idle (the user may have been generating during the first runs): tiled 1 pass 42.8 s, 2 passes 80.1 s (each extra pass about as long as the first, which the Settings hint says); face detailer 2 passes 23.1 s. A crop compared with one pass: more eye and skin detail, no seams |
