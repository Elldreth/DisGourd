# P5-03 — Site admin: General and Image generation pages

- **Unit Type:** Implementation (child of P5-00)
- **Phase:** 5
- **State:** PLANNED (needs P5-02; owner decisions 1, 2 and 4)
- **Effort:** L (may split into a: General + Overview/ComfyUI, b: Quality/Variations/kie.ai/Try it, if the working set gets too big)
- **Depends on:** P5-02 (kit)
- **Serialize with:** anything editing `ImagineAdmin.jsx` or `RegistrationAdmin.jsx`
- **Requirement Source:** `design/settings-review-2026-10/REVIEW.md` S2, S3, V2 (site side) and the "Site admin › Image generation" table.

## Scope
- **General** page: who can sign up, site admins, link previews (moved out of "Registration & access").
- **Image generation** becomes a sub-list of six pages that share one state and one `SaveBar`:
  - Overview: status cards for ComfyUI and kie.ai (from data the admin route already returns), default engine, images per person per day, servers that override it, the 18+ policy.
  - ComfyUI: address and Test connection, workflow, model, model type, text encoder, VAE, VRAM.
  - Quality: hires fix, upscale model, Upscale button mode, face detailer, and an Advanced fold (sampler, scheduler, CFG, steps, negative prompt).
  - Variations: loops and the two strengths, with the explanation.
  - kie.ai: key status and Test key, model, monthly cap.
  - Try it: the test generator (uses saved settings; disabled with a note while there are unsaved changes).
- `ImagineAdmin.jsx` (878 lines) is split into one file per page plus a shared `useImagineSettings` hook holding load, dirty state, reset and save. No server change: the same GET and PUT.

## Acceptance criteria
- [ ] AC-1: no Image generation page is taller than about 1.5 screens at 1024×768 with its folds closed (Quality's Advanced closed).
- [ ] AC-2: changing a field on any page shows the save bar; Save sends exactly what today's Save sends (same request body for the same edits, checked by a test against the old component's output); Reset restores the loaded values.
- [ ] AC-3: moving between pages keeps unsaved edits; closing Settings with unsaved edits asks "Discard changes?".
- [ ] AC-4: Link previews is on General and still saves.
- [ ] AC-5: all existing `ImagineAdmin`, `ImagineLimits`, `ImagineSwitches` and `RegistrationAdmin` tests pass (moved to the new files where needed) with the same assertions.
- [ ] AC-6: a sandbox round trip: change the VRAM tier and the daily limit, save, reload, both persisted.

## Expected Areas of Change
`components/admin/imagine/*` (new: Overview, ComfyUI, Quality, Variations, KieAi, TryIt, `useImagineSettings.js`), `ImagineAdmin.jsx` (removed or a thin shell), `RegistrationAdmin.jsx`, `ProfileDialog.jsx` (section list), tests.

## Working Set / Blast Radius
About 12 files, but each page is small. Behaviour risk is in the save body; AC-2's test guards it.

## Testing Strategy
Characterisation test first: capture the PUT body the current component sends for a set of edits, then keep it passing through the split.

## Out of Scope
New image-generation options; server-side changes; the "not set up" art (P5-06 adds it).

## Starting Baseline
To be recorded at activation.
