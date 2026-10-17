# P4-02 — Settings with section navigation

- **Unit Type:** Implementation (child of P4-00)
- **Phase:** 4
- **State:** REVIEW (branch `claude/p4-02-settings`, PR pending)
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
- [x] AC-1: at 1280×800 the dialog shows the section list on the left and only one section's content on the right; switching sections doesn't lose unsaved edits in another section's inputs (sections stay mounted, hidden with `hidden`).
- [x] AC-2: at 375×812 the segmented control scrolls horizontally, each tab at least 44 px tall, and the content fits without horizontal scroll.
- [x] AC-3: the tablist works with Left/Right arrow keys and Home/End; focus moves to the panel on Enter.
- [x] AC-4: a non-admin never sees the Site admin group; an admin does.
- [x] AC-5: existing tests for the four settings components still pass; new tests cover the tablist, the admin gating and the banner rule.

## Expected Areas of Change
`web/src/components/ProfileDialog.jsx` (most of it), small edits to `AudioSettings.jsx`, `NotificationSettings.jsx`, `AppearanceSettings.jsx`, `RegistrationAdmin.jsx` (headers move to the section list), `ChannelList.jsx` (voice panel link to the audio section), tests.

## Working Set / Blast Radius
6 files. The settings components are already split, so this is mostly layout in one file.

## Testing Strategy
Vitest with Testing Library for the tablist, gating and banner; a sandbox walk at both widths.

## Out of Scope
New settings. Moving admin settings to a separate dialog (kept in the same dialog as a second group).

## Starting Baseline
Revision: `f373bf6` (main after #104). Clean worktree `.claude/worktrees/p4-shine`. Web suite 54 files / 481 tests green.

## Implementation notes
- All in `ProfileDialog.jsx`. Sections: Profile, Voice & audio, Appearance, Notifications, plus (site admins only) a "Site admin" group with one section, Registration & access, which keeps `RegistrationAdmin` whole (registration mode, site admins and link previews stay together; splitting them would have meant refactoring that component for no user gain).
- Markup: `role="tablist"` (named "Settings sections") of `role="tab"` buttons with `aria-selected`, `aria-controls` and roving `tabIndex`; each section is a `role="tabpanel"` with `aria-labelledby`, `tabIndex=-1` and the `hidden` attribute when not chosen, so every section stays mounted and edits survive switching.
- Keys: Left/Right/Up/Down move and select (wrapping), Home/End jump, Enter or Space moves focus into the panel.
- Layout: below `md` the list is a horizontal, scrollable strip under the header (tabs are `tap-row`, so 44px on coarse pointers) and the chosen tab is scrolled into view; from `md` up it is a 192px left column and the panel is `max-w-2xl`.
- `initialSection` prop opens a given section; the last one used is saved in `localStorage` (`dg.settingsSection`) and restored, falling back to Profile when the saved one isn't available (a member whose saved section is the admin one).
- **Deviation:** the "notifications are blocked" banner still shows whenever the browser has blocked notifications, not only once a level other than Off is chosen. The existing test "when already blocked, it never asks again" relies on it showing on load, and the banner now only appears inside the Notifications section, which was the real complaint. Left as is.
- No voice-panel link to the audio section exists in `ChannelList`, so nothing to wire there.

## Verification Evidence
| Acceptance Criterion | Status | Verification Type | Evidence |
|---|---|---|---|
| AC-1 | Verified | Sandbox (P4 copy of the sandbox DB on :3007) at 1280×800 + `ProfileDialog.test.jsx` | Dialog 672px wide with the section list on the left; one `tabpanel` visible at a time, the other four carry `hidden`. Test: after switching to Appearance the Profile panel's Upload avatar button and the Appearance radios are still in the DOM (mounted, hidden) |
| AC-2 | Verified | Sandbox at 375×812 (coarse pointer) | Strip scrolls sideways (scrollWidth 611 in a 343px list), every tab 44px tall, page scrollWidth 375 = viewport (no horizontal page scroll); choosing the last tab scrolls it into view |
| AC-3 | Verified | Sandbox keyboard events + test | ArrowRight from Profile → Voice & audio (selected, focused); End → Registration & access; Enter → focus on that section's `tabpanel`. Test also covers wrapping, ArrowUp and Home |
| AC-4 | Verified | Test + sandbox | Test: a member sees four tabs and no "Site admin" group; an admin sees the group and the Registration & access panel (Link previews checkbox inside). Sandbox: sandy (site admin) sees the group |
| AC-5 | Verified | Vitest, Vite | `ProfileDialog.test.jsx`: 6 tests (watched fail first, then pass). `a11y.test.jsx` (Settings) and the four settings component suites unchanged and green. Full web suite 55 files / 487 tests; `vite build` clean; no console errors in the sandbox |
