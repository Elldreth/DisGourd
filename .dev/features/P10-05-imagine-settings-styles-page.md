# P10-05 — Image generation: a Styles page, full-width model picker, Hires vs Upscale cards, strength sliders, kie.ai Pictures row

- **Unit Type:** Implementation (child of P10-00)
- **Phase:** 10
- **State:** PLANNED
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
- [ ] AC-1: every per-style field is on the Styles page and nowhere else; editing two styles and saving once stores both (existing save body).
- [ ] AC-2: no select in Image generation truncates its value at 1024×768 (text width ≤ box width).
- [ ] AC-3: the strength sliders keep the 0–1 range and the step used today; keyboard arrows work.
- [ ] AC-4: the existing ImagineSettings, QualityPage, StylesSection and allPages tests pass, moved where needed.
- [ ] AC-5: axe clean on each Image generation page.

## Expected Areas of Change
ImagineSettings.jsx, StylesSection.jsx → StylesPage.jsx, ComfyPage.jsx, QualityPage.jsx, KiePage.jsx, ProfileDialog sections, tests.

## Not in scope
Anything not listed above. Other findings in the review belong to their own pass.
