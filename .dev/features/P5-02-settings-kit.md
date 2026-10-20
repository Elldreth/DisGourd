# P5-02 — Settings kit and your settings

- **Unit Type:** Implementation (child of P5-00)
- **Phase:** 5
- **State:** READY after P5-01 (owner decisions agreed 2026-10-19)
- **Effort:** M
- **Depends on:** none in code; the owner's answers
- **Serialize with:** anything editing `ProfileDialog.jsx`, `UserFooter.jsx`, `Modal.jsx`
- **Requirement Source:** `design/settings-review-2026-10/REVIEW.md` S1, S4, S5, S6, F1, A1 and the "One settings kit" section.

## Scope
- New kit under `web/src/components/settings/`:
  - `SettingsLayout`: fixed-size window (about 760 px wide, height `min(680px, 85vh)`), a side list of sections with group labels and an indented sub-list on desktop; on phones (below `md`) full screen with a list of sections first and a page with a back arrow. Keeps today's tablist keyboard model, `initialSection` and the remembered section.
  - `SettingRow`: label, help text, control on the right.
  - `Switch`: `role="switch"` toggle with `aria-checked`, 44 px hit area on coarse pointers.
  - `SaveBar`: sticky "You have unsaved changes · Reset · Save", shown only when dirty. Built here, first used in P5-03.
- One dialog header style in `Modal` (title, optional subtitle, × icon button with "Close" as its name).
- Your settings use the kit: **My account** (avatar, name, email, status with an "Edit status" button that opens the existing status editor, **Sign out** at the bottom), **Voice & video**, **Notifications**, **Appearance**. On/off settings become switches.
- Footer: the sign-out icon becomes a **Settings gear**. Sign out is also added at the bottom of the status menu.
- The Site admin group keeps today's two sections in this unit (P5-03 reshapes them), inside the new layout.

## Acceptance criteria
- [ ] AC-1: switching between any two sections at 1024×768 doesn't move the section list (its bounding box is the same before and after).
- [ ] AC-2: at 375×812 Settings fills the screen, opens on the section list, a section opens with a back arrow, Back (button and hardware back via `overlayHistory`) returns to the list; no horizontal scroll.
- [ ] AC-3: every on/off setting in your settings is a `role="switch"` and toggles with Space.
- [ ] AC-4: the footer shows a Settings gear (named "Settings") and no sign-out icon; Sign out is reachable from My account and from the status menu, and still signs out.
- [ ] AC-5: the tablist keyboard model, `initialSection` and the remembered section still work (existing `ProfileDialog` tests pass or are moved over unchanged in meaning).
- [ ] AC-6: a non-admin sees no Site admin group.

## Expected Areas of Change
`components/settings/*` (new), `ProfileDialog.jsx` (becomes a thin composition), `UserFooter.jsx`, `Modal.jsx`, `AudioSettings.jsx`, `NotificationSettings.jsx`, `AppearanceSettings.jsx` (checkboxes → `SettingRow` + `Switch`), tests.

## Working Set / Blast Radius
About 9 files. `Modal.jsx` is shared by every dialog: the header change must be opt-in (a new `Modal.Header`) so other dialogs move over one by one.

## Testing Strategy
TDD for `Switch`, `SaveBar` and `SettingsLayout` (keyboard, phone drill-down). Sandbox walk at both widths and both themes, with the bounding-box check for AC-1.

## Out of Scope
Splitting Image generation (P5-03); server and channel settings (P5-04, P5-05); new settings.

## Starting Baseline
Revision: to be recorded at activation (main after P5-01).
