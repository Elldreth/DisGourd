# P9-04b — Style presets: Settings

- **Unit Type:** Implementation (child of P9-04)
- **Phase:** 9
- **State:** PLANNED (READY once P9-04a merges)
- **Effort:** M
- **Depends on:** P9-04a

## Scope
- **Image generation › ComfyUI** gets a **Styles** section at the top: a list of styles (name, its model or "Own workflow", and "Default"), with **Add style**, and per style **Edit**, **Duplicate**, **Rename**, **Make default** and **Delete** (asks first; not the last style).
- **Editing a style** shows that style's fields, using today's controls: Built-in / My own; the model picker with its parts and family; Advanced (sampler, scheduler, steps, CFG, negative); a new **Prompt prefix** field; or the three workflow boxes. Shared settings (address, tier, Quality, Variations, Upscale) stay where they are, and say they apply to every style.
- **The save bar** works as today: one draft across pages.

## Acceptance criteria
- [ ] Web: the list and each action; editing writes only that style; Make default; delete asks and can't remove the last; save sends the presets shape; validation errors are shown at the right style.
- [ ] All suites pass; `vite build` is clean.
- [ ] Sandbox: make "Anime" and "Photoreal" styles, save, reload, and they're still there.
