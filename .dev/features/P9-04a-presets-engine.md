# P9-04a — Style presets: engine and server

- **Unit Type:** Implementation (child of P9-04)
- **Phase:** 9
- **State:** COMPLETE (#184)
- **Starting baseline:** main at baccfa4 (#183 merged)
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

## As built
- **`comfyui.js`:**
  - `normalizeConfig` (an old flat config → one "Default" style; no data lost).
  - `styleConfig(cfg, id)`: the shared settings plus one style's, with `fellBack` when the id is gone.
  - `styleList`.
  - `validateConfig` wraps the old checks (`validateFlat`) and runs them for each style. Errors name the style when there's more than one.
- **The old flat shape is still accepted:** it edits the default style, and `publicConfig` still returns the default's fields flat alongside `presets` and `defaultPreset`. The current settings screen keeps working unchanged until P9-04b.
- **Ids** come from the name ("Anime Art" → `anime-art`), or are kept when given. At most 20 styles.
- **The prompt prefix** is stored with one trailing space and added in `generate`, so the bot's message and the stored prompt stay the person's own words. It applies to built-in styles. A custom workflow's `{{prompt}}` gets it too, since it's added before the request is filled.
- **The admin save** checks each style's workflows for missing nodes, named "Mine: Workflow: …", and only the changed ones.
- **Test image (Try it)** uses the default style.
- **Six older ComfyUI config tests** read the effective config through `styleConfig` now; their expectations are unchanged.

## Acceptance criteria
- [x] Server: an old single-setup config reads as one "Default" preset, and saving writes the new shape; preset validation (names, at least one, the default exists, the custom checks); `preset` chosen, defaulted and refused; the prefix in the graph; per-preset model, sampler and negative in the graph; the job stores the preset; Variations, Upscale and Retry reuse it; deleted → default with a note; GET /spaces lists the styles; kie.ai unaffected.
- [x] All suites pass.
- [x] Live (the owner's ComfyUI): two presets with different models; an image from each; a Variation of each keeps its model.

## Evidence (2026-10-20)
| Acceptance criterion | Evidence |
|---|---|
| Server | `imagine-comfyui.test.js` (+3):<br>• **Config:** an old config → `presets: [{ id: 'default', name: 'Default', model, family, sampler, negative }]`, with no top-level `model`; old flat fields edit the default style; a list → ids `default`, `anime-art`, the prefix stored "anime screencap, ".<br>• **Refusals:** empty list, empty name, duplicate names, unknown default, a custom style without a workflow (named "Mine: …"), and a prefix over 300.<br>• **`styleConfig`:** shared plus the style's own; `fellBack` on an unknown id. `styleList` and `publicConfig` (flat default plus `presets`).<br>• **Chat:** `preset: 'nope'` → BAD_OPTION. Anime → job `preset: anime`, Anime's model and sampler in the graph, positive "anime screencap, a gourd at dusk". No style → the default. A Subtle variation of the Anime image → `preset: anime` and its prefix. After Anime is deleted, a Strong variation → the default, with the warning `the style "anime" is gone; used "Photoreal"`. GET /spaces `styles` and `defaultStyle`.<br>• **Admin save:** a style's workflow with an unknown node → "Mine: Workflow: your ComfyUI doesn’t have this node: MyCustomSampler"; a good one saves as id `mine`.<br>Server suites: 50 files, 444. Web: 102 files, 794 (unchanged) |
| Live (the owner's ComfyUI via the sandbox) | Saved `[Default (the existing setup, kept), Photoreal (SDXL\juggernautXL_ragnarokBy, prefix "RAW photo, natural light,")]`; GET /spaces listed both, with default `default`. Same prompt at Draft: Photoreal → job 85 `preset photoreal`, Juggernaut; Default → job 86 `preset default`, the existing SDXL merge; a Subtle variation of the Photoreal image → job 87 `vary`, `preset photoreal`, Juggernaut. ComfyUI's history shows "RAW photo, natural light, a ceramic gourd…" for 85 and 87, and no prefix for 86. About 7 s each |
