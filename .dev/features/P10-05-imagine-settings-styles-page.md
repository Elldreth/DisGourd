# P10-05 — Image generation: a Styles page, full-width model picker, Hires vs Upscale cards, strength sliders, kie.ai Pictures row

- **Unit Type:** Implementation (child of P10-00)
- **Phase:** 10
- **State:** REVIEW
- **Effort:** M–L
- **Depends on:** P10-00 (decisions 1 and 4)
- **Serialize with:** none
- **Requirement Source:** `design/design-review-p10/REVIEW.md` I1–I5.

## Scope
- A new **Styles** page in Image generation (between ComfyUI and Quality): the list (name, model, Default) with Add, Duplicate, Make default and Delete, and the selected style's editor beside it. The editor has the name, workflow, model, prompt prefix and an Advanced fold with sampler, scheduler, CFG, steps, hires steps, CLIP skip and negative. On a phone: list → page.
- ComfyUI keeps the connection and VRAM. Quality loses its Style picker and per-style Advanced; it keeps hires fix, upscale and face detailer.
- The model picker is full width, with Model type under it; Advanced selects go two-up.
- Quality: separate **Hires fix** and **Upscale button** cards. Hires strength and Face repaint strength become sliders with the value shown and a reset link.
- kie.ai: a **Pictures** row with a one-line summary. Optional (decision 4): "Used n of cap credits this month" (a small admin-view field).

## Acceptance criteria
- [x] AC-1: every per-style field is on the Styles page and nowhere else; editing two styles and saving once stores both (existing save body).
- [x] AC-2: no select in Image generation truncates its value at 1024×768 (text width ≤ box width).
- [x] AC-3: the strength sliders keep the 0–1 range and the step used today; keyboard arrows work.
- [x] AC-4: the existing ImagineSettings, QualityPage, StylesSection and allPages tests pass, moved where needed.
- [x] AC-5: axe clean on each Image generation page.

## Expected Areas of Change
ImagineSettings.jsx, StylesSection.jsx → StylesPage.jsx, ComfyPage.jsx, QualityPage.jsx, KiePage.jsx, ProfileDialog sections, tests.

## As built
- **`StylesPage.jsx`** (new; Site admin › Image generation › **Styles**, between ComfyUI and Quality):
  - The styles list with Add / Duplicate / Make default / Delete (`StylesSection`).
  - Under it, a framed panel, "Editing style: X", holding everything that belongs to that style:
    - Style name (`StyleNameField`, with its checks);
    - Workflow (Built-in / My own, with the three workflow boxes);
    - Model, full width, with Model type under it and the parts;
    - Prompt prefix;
    - an **Advanced** fold with sampler, scheduler, CFG, steps, hires steps, CLIP skip and negative prompt.
  - Picking a style in the list switches the whole panel. Quality's second Style picker is gone.
- **ComfyUI** keeps the switch, the address and the graphics memory, plus a summary card ("3 styles · default: Default") with **Edit styles**.
- **Quality:**
  - Three cards: **Hires fix** (the switch and its strength), **Upscale button** (the upscale model, used by both, and the mode with tiled options), and **Face detailer**.
  - The intro links to Styles for the per-style settings.
- **`StrengthSlider.jsx`** (new): Hires strength, Face repaint strength and the tiled Repaint strength are sliders. Each shows its value, labels both ends ("closer to the original" / "more new detail") and has "Reset to <default>" when changed. The ranges and steps are unchanged, and the saved values are numbers as before.
- **kie.ai:**
  - The pictures note became a **Pictures** part of the model card: a one-line summary ("Grok Imagine image-to-image · no strength setting, so Variations are one button"), then Model for pictures when needed, then the upload / 24-hour note as help text.
  - The monthly cap has its own card.
- **A save error naming a style** selects it (as before) and now also opens the Styles page.
- **No server change, and the save body is unchanged** (`ImagineSettingsProvider` already kept shared and per-style fields apart). The optional "credits used this month" (decision 4) was left out.
- **Older tests updated:** the page list (six pages) and the P9-04b test, where Advanced follows the list rather than a picker. The kie.ai note text changed. All the other Image generation tests passed unchanged.

## Verification Evidence
| Acceptance Criterion | Status | Verification Type | Evidence |
|---|---|---|---|
| AC-1 | Verified | `ImagineAdmin.test.jsx` (P10-05 test) + the existing save tests | Model, workflow, prefix and Advanced are only on Styles; Quality has no Sampler; editing two styles and saving once still sends both (P9-04b tests) |
| AC-2 | Verified | Sandbox, measured | At 1280×800 and 1024×768, every select on Styles, Quality and kie.ai fits its text (canvas width ≤ inner width) |
| AC-3 | Verified | Test | Range inputs with the same min, max and step; values are numbers; Reset appears only off the default |
| AC-4 | Verified | Vitest | ImagineAdmin, SiteAdminPages, ImagineSwitches and ImagineLimits pass |
| AC-5 | Verified | axe-core 4.10.2 | ComfyUI, Styles (Advanced open), Quality, kie.ai: no violations |
| Phone | Verified | Sandbox 375×812 | List → page; no sideways scroll |
| Suites | Verified | Vitest, Jest, Vite | Web 104 files / 831 tests; server 53 suites / 461 tests; `vite build` clean |

Screenshots: `design/design-review-p10/shots/p10-05-*.jpg` (the owner's real ComfyUI model names show, as in the sandbox).

## kie.ai spend
None.

## Not in scope
Anything not listed above. Other findings in the review belong to their own pass.
