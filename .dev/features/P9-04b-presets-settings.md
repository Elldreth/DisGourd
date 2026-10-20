# P9-04b — Style presets: Settings

- **Unit Type:** Implementation (child of P9-04)
- **Phase:** 9
- **State:** COMPLETE (#185)
- **Starting baseline:** main at 88c6ba9 (#184 merged)
- **Effort:** M
- **Depends on:** P9-04a

## Scope
- **Image generation › ComfyUI** gets a **Styles** section at the top: a list of styles (name, its model or "Own workflow", and "Default"), with **Add style**, and per style **Edit**, **Duplicate**, **Rename**, **Make default** and **Delete** (asks first; not the last style).
- **Editing a style** shows that style's fields, using today's controls: Built-in / My own; the model picker with its parts and family; Advanced (sampler, scheduler, steps, CFG, negative); a new **Prompt prefix** field; or the three workflow boxes. Shared settings (address, tier, Quality, Variations, Upscale) stay where they are, and say they apply to every style.
- **The save bar** works as today: one draft across pages.

## As built
- **One draft, two views (`ImagineSettings.jsx`):** the provider keeps the shared settings plus `styles` and `defaultStyle`, and which style is being edited. The pages still get a flat `comfy` (shared + the edited style) and `setComfy`, which splits each change back into shared vs the style's own (`STYLE_FIELDS`). So ComfyPage and QualityPage's controls didn't change.
- **Save** sends the shared settings plus `presets` (an id only for saved styles; the server makes new ones from the name) and `defaultPreset`. No flat style fields. After saving, the same style stays selected (matched by name when it was new). A save error starting with a style's name ("Mine: …") selects that style.
- **`StylesSection.jsx`** at the top of ComfyUI, under the address: the rows (name, the model's file name or "Own workflow", a Default badge; click to edit), then Add style, Duplicate, Make default and Delete (asks; disabled for the last; deleting the default makes the first left the default). Rename is a **Style name** field for the selected style rather than a separate mode; empty, too long and duplicate names are flagged there. At most 20 styles.
- **ComfyPage:** "Editing style: X" above the style's fields (Workflow, Model, parts), a new **Prompt prefix (optional)** field, then "Shared by every style" above the VRAM tier.
- **QualityPage Advanced:** with more than one style, a **Style** picker at the top (the same selection as the ComfyUI page), since sampler, scheduler, CFG, steps and negative belong to a style.

## Acceptance criteria
- [x] Web: the list and each action; editing writes only that style; Make default; delete asks and can't remove the last; save sends the presets shape; validation errors are shown at the right style.
- [x] All suites pass; `vite build` is clean.
- [x] Sandbox: make "Anime" and "Photoreal" styles, save, reload, and they're still there.

## Evidence (2026-10-20)
| Acceptance criterion | Evidence |
|---|---|
| Web | `ImagineAdmin.test.jsx` (+2):<br>• An old flat setup shows one "Default" row (Delete disabled). Add style → "Editing style: New style", blank model; renamed Photoreal, its model and prefix " RAW photo, "; Make default; Duplicate → "Photoreal copy"; renaming it "photoreal" → "Another style has this name."; renamed Anime. Changing the tier (shared) and switching back to Default shows Default's own model. Delete Anime asks, then it's gone. Save sends `tier: high`, no top-level `model`, presets `[['default','Default',flux,null], [no id,'Photoreal',Illustrious,'RAW photo,']]`, Default keeps `sampler: euler`, and `defaultPreset` the new style; afterwards two rows and still editing Default.<br>• Two saved styles (Photoreal with Standard steps 30, Mine with Own workflow): rows "Photoreal / Illustrious-XL-v2.0 / Default" and "Mine / Own workflow"; Advanced's Style picker shows Photoreal's 30 and Mine's blank; a save error "Mine: Workflow: …" switches to "Editing style: Mine".<br>• The six older tests now read the save through a `sent()` helper (shared + default style), with `promptPrefix: null` added to the expected blanks; the mock server returns the default's fields flat, like the real one.<br>Web: 102 files, 796 tests. `vite build` clean. Server unchanged (P9-04a) |
| Sandbox (:3005, the owner's ComfyUI) | The ComfyUI page listed Default and Photoreal (made in P9-04a). Add style → named "Anime", Hassaku XL Illustrious v3.1 (SDXL guessed), prefix "anime screencap,"; Save → "Saved", still editing Anime. GET /admin/imagine: `default` (unchanged model), `photoreal` (Juggernaut, its prefix), `anime` (Hassaku, "anime screencap,"), default `default`, tier unchanged. Reloaded: three rows, Default being edited, no unsaved changes; Quality › Advanced shows the Style picker with all three |
