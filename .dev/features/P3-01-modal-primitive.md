# P3-01 — Accessible Modal primitive + migrate the simple dialogs

- **Unit Type:** Implementation
- **Phase:** 3 — "Dialogs need role=dialog, aria-modal, a focus trap and Esc to close"
- **State:** READY
- **Effort:** S–M
- **Depends on:** none
- **Serialize with:** units touching the migrated dialog files
- **Requirement Source:** IMPROVEMENT-PLAN.md Phase 3. Revalidated: there are **zero** `role="dialog"`/`aria-modal` usages in `web/src`. Only Lightbox, SearchOverlay and AudioSettings handle Escape.

## Scope
- New `web/src/components/Modal.jsx`:
  - props: `{ title, onClose, children, size, initialFocusRef, closeOnBackdrop = true }`
  - renders through a portal to `document.body`
  - `role="dialog"`, `aria-modal="true"`, and `aria-labelledby` pointing at the rendered title
  - a focus trap (Tab and Shift+Tab cycle inside)
  - Esc closes; the handler stops propagation so nested Esc handlers (AudioSettings key capture) can claim it first
  - focus is restored to the opener on close, and body scroll is locked
  - uses the existing `anim-scale-in` and `anim-fade` animations
- Migrate **InviteDialog**, **ChannelSettingsDialog** and **ServerPermissionsDialog** to it.

## Acceptance criteria (manual keyboard and screen-reader pass)
- [ ] For each migrated dialog: it opens with focus on the first control (or `initialFocusRef`), Tab never leaves it, Esc closes it, and focus returns to the button that opened it.
- [ ] NVDA or VoiceOver announces "dialog, <title>".
- [ ] Clicking the backdrop closes it; clicking inside doesn't.
- [ ] Visual appearance is unchanged.
- [ ] Optional, if P1-19 has landed: a Vitest + Testing Library test covering the focus trap and Esc.

## Expected Areas of Change
New `web/src/components/Modal.jsx`, plus `web/src/components/{InviteDialog,ChannelSettingsDialog,ServerPermissionsDialog}.jsx`.

## Working Set / Blast Radius
4 files.
