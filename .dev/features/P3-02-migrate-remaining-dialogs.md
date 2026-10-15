# P3-02 — Migrate the remaining overlays to Modal (profile, cropper, search, lightbox)

- **Unit Type:** Implementation
- **Phase:** 3
- **State:** PLANNED (READY after P3-01)
- **Effort:** S–M
- **Depends on:** P3-01
- **Requirement Source:** IMPROVEMENT-PLAN.md Phase 3

## Scope
- **ProfileDialog** (which hosts AudioSettings and RegistrationAdmin). AudioSettings' Esc during PTT-key capture must *not* close the dialog.
- **ImageCropper** (it's stacked above ProfileDialog when reframing an avatar, so nested modals must work: only the top one traps focus and handles Esc).
- **SearchOverlay**: dialog semantics, plus a combobox/listbox pattern for the results with arrow-key navigation.
- **Lightbox**: dialog semantics, arrow keys for prev/next (keep), and labelled prev/next/close buttons.

## Acceptance criteria
- [ ] Each overlay meets P3-01's criteria.
- [ ] Nested case: open ImageCropper from ProfileDialog, and Esc closes only the cropper while focus returns into ProfileDialog.
- [ ] Search: type, ArrowDown and Enter open the result with no mouse.

## Expected Areas of Change
`web/src/components/{ProfileDialog,ImageCropper,SearchOverlay,Lightbox,AudioSettings}.jsx`, and possibly `Modal.jsx` (a stack counter).

## Working Set / Blast Radius
5–6 files.
