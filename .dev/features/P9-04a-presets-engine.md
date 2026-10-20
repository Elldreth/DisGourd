# P9-04a — Style presets: engine and server

- **Unit Type:** Implementation (child of P9-04)
- **Phase:** 9
- **State:** READY
- **Effort:** M (migration v28)
- **Depends on:** P9-04 design (agreed 2026-10-20)

## Scope
- **Config:**
  - `engines.comfyui.presets = [{ id, name, mode, kind, model, family, clip1, clip2, vae, sampler, scheduler, steps, cfgScale, negative, promptPrefix, workflow, upscaleWorkflow, img2imgWorkflow }]` and `defaultPreset`.
  - On first read of an older config, the current per-style fields become preset `{ id: 'default', name: 'Default' }`. Saving writes the new shape; the old top-level fields are dropped.
- **Validation:** each preset is checked as the single setup is today: a model or custom workflow required; custom workflows checked for placeholders and nodes on save, and only when changed. Names are 1–30 characters and unique. There's at least one preset, and `defaultPreset` must exist.
- **Generation:**
  - `imagine` takes `preset` (optional, else the default); an unknown preset → BAD_OPTION.
  - The engine builds the graph from shared settings plus the preset's.
  - `promptPrefix` goes before the prompt.
- **Jobs:** migration v28 adds `imagine_jobs.preset TEXT`. Variations, Upscale and Retry use the source job's preset; if it was deleted, they use the default and the runner logs a note.
- **GET /spaces `imagine`** adds `styles: [{ id, name }]` and `defaultStyle` when ComfyUI is on.
- **The admin view** returns the presets, with custom workflows as text as today.

## Acceptance criteria
- [ ] Server: an old single-setup config reads as one "Default" preset, and saving writes the new shape; preset validation (names, at least one, the default exists, the custom checks); `preset` chosen, defaulted and refused; the prefix in the graph; per-preset model, sampler and negative in the graph; the job stores the preset; Variations, Upscale and Retry reuse it; deleted → default with a note; GET /spaces lists the styles; kie.ai unaffected.
- [ ] All suites pass.
- [ ] Live (the owner's ComfyUI): two presets with different models; an image from each; a Variation of each keeps its model.
