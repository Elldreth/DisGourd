# P3-35 — Anima models (ComfyUI)

- **Unit Type:** Implementation
- **Phase:** 3
- **State:** PLANNED
- **Effort:** S–M
- **Depends on:** P3-24 (split models), P3-34 (custom workflows, an interim route)
- **Requirement Source:** the user, 2026-10-18: "at some point we'll need to add in support for anima models".

## Known so far
- **On the user's ComfyUI (2026-10-18):**
  - UNETLoader has `Anima\Skirkscendance_v1.safetensors` and `Anima\anima-preview3-base.safetensors`;
  - CLIPLoader has `Anima\qwen_3_06b_base.safetensors`;
  - VAELoader has `Anima\qwen_image_vae.safetensors`.
- **Today** they're listed as split models with no type ("pick its type"), and only Flux / Z-Image can be chosen, so they can't run with the built-in workflow. A host can already run them through a custom workflow (P3-34).

## Scope (to confirm at activation)
- **A new family `anima`** for split models:
  - guessed from an "anima" folder or name;
  - parts suggested by name (the qwen_3_06b text encoder; the qwen_image VAE in the same folder).
- **The right loader and sampling graph:** CLIPLoader `type` and any model-sampling node, sampler / scheduler / CFG / steps per quality, and the latent node. Take these from Anima's reference ComfyUI workflow at activation; don't guess.
- **Live check** on the user's ComfyUI with both models.

## Open questions (at activation)
- Anima's reference workflow, from its model card or ComfyUI example: which CLIPLoader type, sampler settings and resolution.
