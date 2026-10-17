# P4-02 — Settings with section navigation

- **Unit Type:** Implementation (child of P4-00)
- **Phase:** 4
- **State:** READY
- **Effort:** M
- **Depends on:** none
- **Serialize with:** anything editing `ProfileDialog.jsx`, `AudioSettings.jsx`, `NotificationSettings.jsx`, `AppearanceSettings.jsx`, `RegistrationAdmin.jsx`
- **Requirement Source:** `design/UX-REVIEW-2026-10.md` F1. The Settings dialog is one ~1,700 px scroll with Profile, Voice & audio, Appearance, Notifications, Message sounds, Registration & access, Site admins and Link previews, no tabs or anchors.

## Scope
- `ProfileDialog.jsx` becomes a two-pane dialog on `md` and up: a left list of sections (Profile, Voice & audio, Appearance, Notifications; and for site admins a second group "Site admin" with Registration & access, Site admins, Link previews). The right pane shows one section and scrolls on its own.
- Below `md`: a horizontal segmented control (scrollable) at the top of the dialog, same sections.
- The section list is a `role="tablist"` with arrow-key navigation; the pane is a `tabpanel`. The chosen section persists in `localStorage` (per-viewer convenience).
- The "notifications are blocked" banner shows only when the chosen level is not Off.
- A deep-link prop (`initialSection`) so other UI can open Settings at a section (the voice panel's "Audio settings" link, the Registration link from the wizard copy).

## Acceptance criteria
- [ ] AC-1: at 1280×800 the dialog shows the section list on the left and only one section's content on the right; switching sections doesn't lose unsaved edits in another section's inputs (sections stay mounted, hidden with `hidden`).
- [ ] AC-2: at 375×812 the segmented control scrolls horizontally, each tab at least 44 px tall, and the content fits without horizontal scroll.
- [ ] AC-3: the tablist works with Left/Right arrow keys and Home/End; focus moves to the panel on Enter.
- [ ] AC-4: a non-admin never sees the Site admin group; an admin does.
- [ ] AC-5: existing tests for the four settings components still pass; new tests cover the tablist, the admin gating and the banner rule.

## Expected Areas of Change
`web/src/components/ProfileDialog.jsx` (most of it), small edits to `AudioSettings.jsx`, `NotificationSettings.jsx`, `AppearanceSettings.jsx`, `RegistrationAdmin.jsx` (headers move to the section list), `ChannelList.jsx` (voice panel link to the audio section), tests.

## Working Set / Blast Radius
6 files. The settings components are already split, so this is mostly layout in one file.

## Testing Strategy
Vitest with Testing Library for the tablist, gating and banner; a sandbox walk at both widths.

## Out of Scope
New settings. Moving admin settings to a separate dialog (kept in the same dialog as a second group).

## Verification Evidence
| Acceptance Criterion | Status | Verification Type | Evidence |
|---|---|---|---|
| AC-1 | Not verified | | |
| AC-2 | Not verified | | |
| AC-3 | Not verified | | |
| AC-4 | Not verified | | |
| AC-5 | Not verified | | |
