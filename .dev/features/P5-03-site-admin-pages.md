# P5-03 — Site admin: General and Image generation pages

- **Unit Type:** Implementation (child of P5-00)
- **Phase:** 5
- **State:** REVIEW (PR open, 2026-10-19)
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
- [x] AC-1: no Image generation page is taller than about 1.5 screens at 1024×768 with its folds closed (Quality's Advanced closed).
- [x] AC-2: changing a field on any page shows the save bar; Save sends exactly what today's Save sends (same request body for the same edits, checked by a test against the old component's output); Reset restores the loaded values.
- [x] AC-3: moving between pages keeps unsaved edits; closing Settings with unsaved edits asks "Discard changes?".
- [x] AC-4: Link previews is on General and still saves.
- [x] AC-5: all existing `ImagineAdmin`, `ImagineLimits`, `ImagineSwitches` and `RegistrationAdmin` tests pass (moved to the new files where needed) with the same assertions.
- [x] AC-6: a sandbox round trip: change the VRAM tier and the daily limit, save, reload, both persisted.

## Expected Areas of Change
`components/admin/imagine/*` (new: Overview, ComfyUI, Quality, Variations, KieAi, TryIt, `useImagineSettings.js`), `ImagineAdmin.jsx` (removed or a thin shell), `RegistrationAdmin.jsx`, `ProfileDialog.jsx` (section list), tests.

## Working Set / Blast Radius
About 12 files, but each page is small. Behaviour risk is in the save body; AC-2's test guards it.

## Testing Strategy
Characterisation test first: capture the PUT body the current component sends for a set of edits, then keep it passing through the split.

## Out of Scope
New image-generation options; server-side changes; the "not set up" art (P5-06 adds it).

## Starting Baseline
Revision: `1116617` (main after #160). Web suite before: 84 files / 697 tests.

## Implementation notes
- Done as one unit; the split into a/b wasn't needed, because each page file is small.
- `components/admin/imagine/`:
  - `constants.js`: the lists, unchanged.
  - `ImagineSettings.jsx`: the provider that holds every draft, plus `saveBody()`, which is exactly the old Save body; `ImagineSaveBar`; `ImagineLoading`.
  - One file per page: `OverviewPage`, `ComfyPage`, `QualityPage`, `VariationsPage`, `KiePage`, `TryPage`.
  - `allPages.testutil.jsx`: renders every page with one save bar, for the tests.
  - `ImagineAdmin.jsx` is deleted.
- Unsaved changes: the drafts are compared with a snapshot taken at load and at save. The automatic connection test on open fills in the suggested upscale model and face detector. It updates the snapshot too, so opening never shows a save bar, but the suggestions are still saved with the next real save, as before. Reset restores the snapshot.
- `ProfileDialog`:
  - Site admin is now General plus Image generation and five indented pages.
  - The provider wraps the layout for site admins only.
  - Every page except Try it has a save bar.
  - With unsaved changes, Close (×, Esc or the backdrop) asks "Discard changes?".
  - The Overview's engine cards open their page (`onNavigate`).
- Overview cards: on/off, the saved model, and either "Reachable · N models" / "Not reachable right now" (ComfyUI) or the key and cap (kie.ai). **Deviation:** the review imagined "12 of 100 credits this month". The admin route doesn't return this month's spend, and this unit makes no server change, so the card shows the cap. This is recorded below.
- The face detailer moved out of Advanced into its own card on Quality, since it's a common switch, not a tuning knob. Variations has its own page.
- On/off settings on these pages are switches now: ComfyUI on, kie.ai on, hires fix, face detailer, 18+ policy, and Link previews on General.
- Layout: the ComfyUI page was 1.82 screens tall. The workflow choices, the VRAM tiers, Model and Model type, and the model parts now sit side by side from `sm` up, which brings it to 1.43.
- Test changes:
  - `ImagineAdmin.test.jsx` and `ImagineLimits.test.jsx` render all pages through the test util, and the button is now "Save changes".
  - Two tests clicked Save without changing anything. Since a save bar only appears with a change, they now make one first: switching ComfyUI on (its error is about turning it on), and editing the refused workflow box. The assertions are the same.
  - `ProfileDialog.test.jsx` and `RegistrationAdmin.test.jsx`: the General name, the ComfyUI address found on its page, and `checkbox` → `switch` for Link previews.

## Discovered Work (not done here)
- The Overview could show kie.ai's spend this month, if the admin route returned it (a small server change).
- The servers-with-their-own-limit note still says "that server's menu → Image generation". P5-04 moves this into Server settings and should update the wording.

## Verification Evidence
| Acceptance Criterion | Status | Verification Type | Evidence |
|---|---|---|---|
| AC-1 | Verified | Sandbox (server :3005, this branch's dev server :5175), 1024×768 | Each page's scroll height ÷ visible height: General 1.00, Overview 1.27, ComfyUI 1.43 (was 1.82 before the side-by-side layout), Quality 1.28 (Advanced closed), Variations 1.00, kie.ai 1.00, Try it 1.00. Before: one 2,266 px form (3.8 screens). `shots/p5-03-*.jpg` |
| AC-2 | Verified | Tests + sandbox | `SiteAdminPages.test.jsx`: the bar appears on an edit, and Reset restores. Save sends edits from two pages in one body. The existing save-body assertions in `ImagineAdmin.test.jsx` pass unchanged. Sandbox: the save bar appeared (`shots/p5-03-save-bar.jpg`) |
| AC-3 | Verified | Tests + sandbox | Tests: Loops changed on Variations is still there after visiting Quality; Close with changes asks; Cancel stays, Discard closes. Sandbox: `shots/p5-03-discard-changes.jpg` |
| AC-4 | Verified | Tests + sandbox | Link previews is on General as a switch (`shots/p5-03-general.jpg`); `RegistrationAdmin.test.jsx` toggles it and the API call is the same |
| AC-5 | Verified | Vitest, Vite | All the existing image-settings tests pass with the same assertions (changes listed above). New `SiteAdminPages.test.jsx`: 7 tests. Full web suite 85 files / 704 tests; `vite build` clean |
| AC-6 | Verified | Sandbox round trip | Set VRAM to Low and the daily limit to 45, saved, reloaded: the admin API returned `tier: low`, `dailyLimit: 45`. Then I put back High and 60 through the same pages and saved (checked through the API). Opening showed no save bar, though the automatic test had run |
| Phone | Verified | Sandbox at 375×812 | The list shows the indented sub-pages (`shots/p5-03-phone-list.jpg`). The ComfyUI page is 375 px wide with nothing overflowing (`shots/p5-03-phone-comfyui.jpg`) |
