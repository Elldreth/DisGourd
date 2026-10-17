# P3-02 — Migrate the remaining overlays to Modal (profile, cropper, search, lightbox)

- **Unit Type:** Implementation
- **Phase:** 3
- **State:** REVIEW (PR open)
- **Effort:** S–M
- **Depends on:** P3-01
- **Requirement Source:** IMPROVEMENT-PLAN.md Phase 3

## Scope
- **ProfileDialog** (which hosts AudioSettings and RegistrationAdmin). AudioSettings' Esc during PTT-key capture must *not* close the dialog.
- **ImageCropper** (it's stacked above ProfileDialog when reframing an avatar, so nested modals must work: only the top one traps focus and handles Esc).
- **SearchOverlay**: dialog semantics, plus a combobox/listbox pattern for the results with arrow-key navigation.
- **Lightbox**: dialog semantics, arrow keys for prev/next (keep), and labelled prev/next/close buttons.

## Acceptance criteria
- [x] Each overlay meets P3-01's criteria.
- [x] Nested case: open ImageCropper from ProfileDialog, and Esc closes only the cropper while focus returns into ProfileDialog.
- [x] Search: type, ArrowDown and Enter open the result with no mouse.

## Expected Areas of Change
`web/src/components/{ProfileDialog,ImageCropper,SearchOverlay,Lightbox,AudioSettings}.jsx`, and possibly `Modal.jsx` (a stack counter).

## Working Set / Blast Radius
5–6 files.

## Evidence
| Check | Result |
|---|---|
| `Modal.test.jsx` (+5): `label` names a dialog with no visible heading and `backdropClassName` replaces the backdrop; a key a control already handled (capture-phase `preventDefault`, like the push-to-talk recorder) is ignored, Tab included; nested: Tab stays in the top dialog, Esc closes only it and focus returns into the one below; a nested backdrop click closes only that dialog; `fill`: clicking the media doesn't close, clicking the panel's empty area does | pass (failed first, except the nested-Esc case, which React's portal event bubbling already handled; one test was itself wrong about portal DOM order and was fixed) |
| `SearchOverlay.test.jsx` (3): dialog + combobox focused on open; type, ↓ ×4 (stops at the last), Enter opens the DM result; ↑, Enter opens the channel result; `aria-activedescendant` / `aria-selected` follow; Enter with nothing highlighted does nothing; Esc closes once | pass (failed first) |
| `Lightbox.test.jsx` (3): dialog named "Image 2 of 3: two.png", Close / Previous image / Next image labelled, focus inside; ← → still move; Esc closes once; clicking the image doesn't close, clicking around it does | pass (failed first) |
| Full suite / build | web 321/321, lint clean, build ok |
| Sandbox, Settings (real keys): Enter on "Edit your profile" -> dialog "Settings", aria-modal, focus on the first control (mic "Enable"; the hidden file input is skipped); Push-to-talk on, "Set key", Enter -> "Press any key… (Esc cancels)"; Esc -> recording cancelled, dialog stays open; Esc -> closed, focus back on "Edit your profile" | pass |
| Sandbox, nested: avatar file chosen in Settings -> "Position your avatar" over "Settings", focus on Zoom; Tab ×4 stays in the cropper; Esc -> only the cropper closes, focus back inside Settings | pass |
| Sandbox, Search (real keys): Enter on the search button, type "general new" -> 3 options, `aria-expanded=true`; ↓ highlights "general new 3" (`aria-selected`); Enter -> search closes, #general opens (from #random) | pass |
| Sandbox, Lightbox (real keys): Enter on a thumbnail -> dialog "Image 1 of 3: one.png", focus on Close; → -> "Image 2 of 3: two.png"; Tab ×4 stays inside; Esc -> closed, focus back on the thumbnail; backdrop still `bg-black/90`; no console errors | pass |

## Implementation notes
- Modal gained: `label`, `backdropClassName`, `fill` (panel covers the screen; a click on its own empty area closes), `animate` (the Lightbox keeps no scale-in, as before).
- Nesting: each Modal ignores keys whose target isn't inside its own panel (keys from a stacked dialog bubble through React portals) and keys a control already handled; backdrop clicks stop propagating. If the opener is gone or can't take focus when a dialog closes (the cropper's opener is the hidden file input), focus goes to the dialog underneath.
- "Shown" now also excludes elements inside `display: none`, so hidden file inputs aren't picked as the first control or trap edge.
- ProfileDialog renders ImageCropper inside its Modal so they nest; AudioSettings needed no change (its capture-phase listener already calls `preventDefault`, which Modal now respects for Tab too).
- Search: input is a `combobox` (`aria-controls`, `aria-activedescendant`, `aria-autocomplete="list"`); results are a `listbox` with `group`s per section and `option` rows; the input's own Esc handler was removed (Modal closes it once). Lightbox: the window Esc handler was removed for the same reason.
- Tests were written first and seen failing.

## Not verified
- A real screen reader.

## Discovered Work
- The **"Upload avatar"** control in Settings is a `<label>` around a hidden file input, so it can't be reached with Tab. Make it a button that clicks the input (fits P3-03).
