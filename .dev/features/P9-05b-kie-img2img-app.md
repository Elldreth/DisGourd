# P9-05b — kie.ai image-to-image: the app

- **Unit Type:** Implementation (child of P9-05)
- **Phase:** 9
- **State:** READY (once P9-05a merges)
- **Effort:** S–M
- **Depends on:** P9-05a

## Scope
- **The /imagine panel:**
  - "Start from a picture" shows when the chosen engine can do pictures (GET /spaces `pictures`).
  - The Strength chips show only when that engine has strength. Otherwise this note shows: "The picture guides the image; your prompt says what to change."
  - Switching the engine updates both.
- **Variation buttons (`ImagineAgain`):**
  - A kie.ai image (`imagineEngine: 'kie'`) whose model has no strength gets one **🎲 Variation** button, which sends `vary: 'once'`.
  - Other images keep Subtle and Strong, as today.
  - Upscale shows only when ComfyUI is on, as today.
  - "varied: …" messages (no strength) are recognized.
- **Settings › kie.ai:**
  - A **Model for pictures** picker, shown when the main model is Z-Image or custom.
  - A line under the model saying which picture model it uses, e.g. "Pictures use Flux-2 Pro image-to-image".
  - The upload note: "For pictures, DisGourd uploads the one picture to kie.ai's file storage for that job; kie.ai deletes it after 24 hours."

## Acceptance criteria
- [ ] Web:
  - The panel's picture row and Strength chips for ComfyUI, for kie.ai with strength and without, and after switching engines.
  - The single Variation button sends `once`.
  - Settings: when the picker shows, saving `pictureModel`, and the note.
- [ ] All suites pass; `vite build` is clean.
- [ ] Sandbox: start from a picture with kie.ai, then make a Variation of the result. This spends a few real credits, so the owner OKs it first.
