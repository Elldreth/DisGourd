# P3-24 — ComfyUI models that aren't single checkpoint files

- **Unit Type:** Implementation
- **Phase:** 3
- **State:** COMPLETE (merged #135)
- **Effort:** M
- **Depends on:** P2-20b (ComfyUI engine)
- **Starting baseline:** main at cc3cfa2 (#134 merged)
- **Serialize with:** P3-28 hires fix (same engine file); P3-28 is built after this one.
- **Requirement Source:** the user, 2026-10-18: "support for ComfyUI models that aren't single checkpoint files". Scope agreed 2026-10-18: Flux-style split models and Z-Image Turbo. Not included: Krea 2, Anima, Kolors and the video models.

## What the user's ComfyUI has (127.0.0.1:8188, checked 2026-10-18)
- **UNETLoader:**
  - Flux-style: `flux1-dev-fp8`, `FLUX_Breasts`, `pixelwave_flux1Dev03`, `realflux10b_10bTransformerDev`.
  - Z-Image Turbo: `zturbo\z_image_turbo_bf16`.
  - Also present: `krea2_turbo…`, `Anima\…`, `kolors\…`, and hunyuan / minimax video models.
- **Text encoders** (CLIPLoader / DualCLIPLoader lists): `clip_l.safetensors`, `t5xxl_enconly.safetensors`, `t5\google_t5-v1_1-xxl_encoderonly-fp8_e4m3fn.safetensors`, `zturbo\qwen_3_4b.safetensors`, and others.
- **VAEs:** `FLUX1\ae.sft`, `zturbo\ae.safetensors`, `SDXL\sdxl_vae.safetensors`, and others.

## Scope
- **It must work with any host's ComfyUI** (user, 2026-10-18). Nothing is tied to this PC's file names: every list comes from the ComfyUI the host points at, the encoder and VAE suggestions are only name-based guesses shown in dropdowns, and a UNET whose family can't be guessed is left for the host to set. If the split-part loaders can't be listed (an older ComfyUI or a stripped install), checkpoints keep working and no split models are offered.
- **Listing:** "Test connection" also lists `UNETLoader` models, except obvious video models (hunyuan_video, ltx, minimax, wan, mochi, cosmos and similar), along with the text encoders and VAEs.
  - Each model is `{ name, family, kind: 'checkpoint' | 'unet' }`.
  - A split model also carries suggested `parts: { clip1, clip2?, vae }`, picked by name: Flux takes clip_l + t5xxl + an `ae` VAE (one in a flux folder first); Z-Image takes qwen_3_4b + the `ae` VAE in its folder.
- **New family `zimage`** (Z-Image Turbo, split only): UNETLoader → ModelSamplingAuraFlow (shift 3), CLIPLoader (type lumina2) and VAELoader. KSampler uses res_multistep / simple at cfg 1, with 6 / 8 / 10 steps for draft / standard / high, and an EmptySD3LatentImage.
- **Flux split:** UNETLoader + DualCLIPLoader (type flux) + VAELoader. The rest of the Flux graph (FluxGuidance, EmptySD3LatentImage) is unchanged.
- **Config** gains `kind`, `clip1`, `clip2` and `vae`. For a split model: the family must be flux or zimage, and turning it on needs the encoders and the VAE (Flux needs both encoders). Z-Image can't be a checkpoint.
- **A refusal** naming `unet_name` / `clip_name` / `vae_name` reads "The … "x" isn't in ComfyUI any more".
- **Settings:** the model list is split into "Checkpoints" and "Separate parts (diffusion models)". Picking a split model fills Text encoder 1 / 2 and VAE with the suggestions; each is a dropdown of what ComfyUI has. "Model type" offers Z-Image Turbo for split models.

## Acceptance criteria
- [x] Server: `listModels` still works when UNETLoader / CLIPLoader / VAELoader info is missing (checkpoints only); it returns checkpoints and non-video UNETs with their kind and family, the encoders and VAEs, and the suggested parts. The Flux split workflow and the Z-Image workflow have the right loaders and wiring (snapshot of the node types and links). The checkpoint workflows are unchanged. Config validation covers the rules above. An end-to-end generate with a split model goes through the mock.
- [x] Web: Test connection groups the models; picking a split model fills the encoder and VAE dropdowns from the suggestions and offers Z-Image Turbo; Save sends `kind`, `clip1`, `clip2` and `vae`; a checkpoint hides the parts.
- [x] All suites pass; `vite build` is clean.
- [x] Live, on the user's ComfyUI: a test image from `flux1-dev-fp8` (split) and from Z-Image Turbo.

## Discovered Work
- (none yet)
