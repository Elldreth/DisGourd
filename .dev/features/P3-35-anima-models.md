# P3-35 — Anima models (ComfyUI)

- **Unit Type:** Implementation
- **Phase:** 3
- **State:** REVIEW
- **Starting baseline:** main at a10d38c (#149 merged)
- **Effort:** S–M
- **Depends on:** P3-24 (split models), P3-34 (custom workflows, an interim route)
- **Requirement Source:** the user, 2026-10-18: "at some point we'll need to add in support for anima models".

## Known so far
- **On the user's ComfyUI (2026-10-18):**
  - UNETLoader has `Anima\Skirkscendance_v1.safetensors` and `Anima\anima-preview3-base.safetensors`;
  - CLIPLoader has `Anima\qwen_3_06b_base.safetensors`;
  - VAELoader has `Anima\qwen_image_vae.safetensors`.
- **Today** they're listed as split models with no type ("pick its type"), and only Flux / Z-Image can be chosen, so they can't run with the built-in workflow. A host can already run them through a custom workflow (P3-34).

## Reference (Comfy's official templates, fetched 2026-10-19)
- `image_anima_preview.json` and `image_anima_base_v1.json` (Comfy-Org/workflow_templates):
  - loaders: UNETLoader (default dtype); CLIPLoader `qwen_3_06b_base.safetensors` **type `stable_diffusion`**; VAELoader `qwen_image_vae.safetensors`;
  - latent: EmptyLatentImage 1024²;
  - sampling: KSampler with 30 steps, CFG 4, scheduler simple, sampler **er_sde** (preview) or **euler** (base v1);
  - negative prompt: "worst quality, low quality, score_1, score_2, score_3, blurry, jpeg artifacts, sepia".
- [docs.comfy.org Anima tutorial](https://docs.comfy.org/tutorials/image/anima/anima.md): the files and folders; anime / non-photoreal only.

## Scope (built)
- **New family `anima`** (split models only):
  - mp 0.8 / 1.0 / 1.6;
  - steps 20 / 30 / 40;
  - CFG 4;
  - er_sde / simple;
  - CLIPLoader type `stable_diffusion`;
  - EmptyLatentImage, no AuraFlow and no Flux guidance;
  - its own default negative (plus the safety words outside 18+). The host's Advanced negative replaces it as for SDXL.
- **Recognition:** guessed from "anima" in the name or folder. Parts are suggested by name: the qwen_3_06b encoder and the qwen_image_vae, preferring an Anima folder.
- **Settings:** "Anima" in the Model type list for split models, with the Advanced defaults (er_sde, simple, CFG 4, 20 / 30 / 40).
- **Shared features:** img2img loopback Variations, Start from a picture, the hires fix, the face detailer and the tiled upscale all work through the shared graph.

## Acceptance criteria
- [x] Engine: guess, part suggestions, the graph (11 UNETLoader, 12 CLIPLoader stable_diffusion, 13 VAELoader, EmptyLatentImage, KSampler 30 / 4 / er_sde / simple, no 10 / 14), the negative rules, split-only validation; the listing suggests Anima parts (none on the mock).
- [x] Web: Anima offered for split models.
- [x] All suites pass; `vite build` is clean.
- [x] Live: both of the user's Anima models make images.

## Evidence (2026-10-19)
| Acceptance criterion | Evidence |
|---|---|
| Engine | `imagine-comfyui.test.js` (38, 1 new + 2 updated): as above; the negative is "worst quality, … sepia, nsfw, nude, nudity" outside 18+, the plain Anima negative inside, and "bad hands, nsfw, nude, nudity" with the host's own; a checkpoint with family anima is refused; `suggested.anima` is all null on the mock. Server: 364 |
| Web | `ImagineAdmin.test.jsx`: split-model types `['flux', 'zimage', 'anima']`. Web: 650; build clean |
| Live (user's ComfyUI) | `listAll` found `Anima\Skirkscendance_v1` and `Anima\anima-preview3-base` as family anima, and suggested `Anima\qwen_3_06b_base.safetensors` + `Anima\qwen_image_vae.safetensors`. Standard square, high tier: Skirkscendance 1024² in 11.1 s; preview3 1024² in 9.3 s; both clean anime renders of "a small green gourd wearing a black top hat". Sandbox restarted on this branch |
