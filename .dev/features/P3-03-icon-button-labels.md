# P3-03 — Accessible names for icon-only buttons (IconButton sweep)

- **Unit Type:** Implementation
- **Phase:** 3 — "Icon buttons need aria-label"
- **State:** PLANNED
- **Effort:** S–M (mechanical, but wide)
- **Depends on:** P3-02 and P3-05 (those units restructure the files that hold most icon buttons; sweeping after them avoids rework)
- **Serialize with:** **effectively exclusive.** It touches about 12 component files, so run it when no other client unit is in flight.
- **Requirement Source:** IMPROVEMENT-PLAN.md Phase 3. Revalidated: icon buttons use `title=` (a tooltip). Only `Icon.jsx` and `Gourd.jsx` set `aria-label`, on the SVG.

## Scope
- New `web/src/components/IconButton.jsx` with props `{ icon, label, size, className, ...rest }`. It renders a `<button type="button" aria-label={label} title={label}>`, and the Icon inside it gets `aria-hidden`.
- Replace icon-only buttons in: ChatPanel, ChannelList, ServerRail, Composer, MessageActions, MemberList, DmPanel, DmSidebar, UserFooter, VideoStage, Album, Lightbox. Toggle buttons (mute, deafen, camera, share) get `aria-pressed`.
- Unread and mention badges get screen-reader text ("3 unread, 1 mention").

## Acceptance criteria
- [ ] An axe DevTools scan of the main chat view, a DM and settings shows 0 "button-name" violations.
- [ ] Toggle buttons announce their pressed state.
- [ ] No visual change.

## Expected Areas of Change
New `IconButton.jsx`, plus the ~12 components above (small edits).

## Working Set / Blast Radius
Wide, shallow edits.
