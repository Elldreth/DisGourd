# P3-24 — ComfyUI models that aren't single checkpoint files

- **Unit Type:** Implementation
- **Phase:** 3
- **State:** PLANNED
- **Effort:** M
- **Depends on:** P2-20b (ComfyUI engine)
- **Requirement Source:** the user, 2026-10-18, after P2-20b, which noted that standalone diffusion models (Flux dev/schnell as a UNet plus separate text encoders and VAE, and SD3.5 or similar) can't be picked today because only `CheckpointLoaderSimple` names are listed.

## Scope (to confirm at activation)
- **List** `UNETLoader` models (`models/diffusion_models` / `unet`) alongside checkpoints, marked as "separate parts".
- **Settings:** for a split model, choose the text encoder(s) (`DualCLIPLoader` for Flux: clip_l + t5xxl; type flux) and the VAE (`VAELoader`). Pick sensible defaults from what ComfyUI lists (names containing t5xxl / clip_l / ae).
- **Workflow:** UNETLoader + DualCLIPLoader + VAELoader in place of CheckpointLoaderSimple. The rest of the Flux graph stays as it is.
- The test image in Settings works for both kinds.

## Open questions (ask at activation)
- Which split models are on the user's ComfyUI (Flux dev fp8 UNet? SD3.5? HiDream?), and which encoders and VAE go with them.
- Whether GGUF UNets (the ComfyUI-GGUF custom node, `UnetLoaderGGUF`) matter.
