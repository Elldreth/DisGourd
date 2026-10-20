# P5-02 — Settings kit and your settings

- **Unit Type:** Implementation (child of P5-00)
- **Phase:** 5
- **State:** REVIEW (PR open, 2026-10-19)
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
- [x] AC-1: switching between any two sections at 1024×768 doesn't move the section list (its bounding box is the same before and after).
- [x] AC-2: at 375×812 Settings fills the screen, opens on the section list, a section opens with a back arrow, Back (button and hardware back via `overlayHistory`) returns to the list; no horizontal scroll.
- [x] AC-3: every on/off setting in your settings is a `role="switch"` and toggles with Space.
- [x] AC-4: the footer shows a Settings gear (named "Settings") and no sign-out icon; Sign out is reachable from My account and from the status menu, and still signs out.
- [x] AC-5: the tablist keyboard model, `initialSection` and the remembered section still work (existing `ProfileDialog` tests pass or are moved over unchanged in meaning).
- [x] AC-6: a non-admin sees no Site admin group.

## Expected Areas of Change
`components/settings/*` (new), `ProfileDialog.jsx` (becomes a thin composition), `UserFooter.jsx`, `Modal.jsx`, `AudioSettings.jsx`, `NotificationSettings.jsx`, `AppearanceSettings.jsx` (checkboxes → `SettingRow` + `Switch`), tests.

## Working Set / Blast Radius
About 9 files. `Modal.jsx` is shared by every dialog: the header change must be opt-in (a new `Modal.Header`) so other dialogs move over one by one.

## Testing Strategy
TDD for `Switch`, `SaveBar` and `SettingsLayout` (keyboard, phone drill-down). Sandbox walk at both widths and both themes, with the bounding-box check for AC-1.

## Out of Scope
Splitting Image generation (P5-03); server and channel settings (P5-04, P5-05); new settings.

## Starting Baseline
Revision: `2d574ce` (main after #158 and #159). Web suite before: 82 files / 685 tests.

## Implementation notes
- Kit in `web/src/components/settings/`:
  - `Switch`: a real checkbox with `role="switch"`, invisible over a drawn track. It keeps Space, label clicks and `checked`. The drawing follows the `checked` prop. The off track is `gray-500`, which shows clearly in both themes (the first try, `ink-500`, almost vanished in light).
  - `SettingRow`: a `<label>` row, `tap-row`.
  - `SaveBar`: built and tested here, first used in P5-03.
  - `SettingsLayout`: the tablist and panels, phone list → page with `data-view`, a Back button, and the hardware back through `useOverlayHistory`, enabled below 768 px. Back returns focus to the section's row. Group labels; `indent` gives `pl-6` for P5-03's sub-pages; each page gets an `<h2>` with its name; a new section scrolls to its top.
- `Modal.Header`: title, optional subtitle and an × named Close. It's opt-in, so for now only Settings uses it; the other dialogs move over in their own units (P5-04, P5-05).
- `ProfileDialog` is now a thin composition: fixed size `md:h-[min(680px,85vh)]` and `md:max-w-3xl`, full screen (`h-dvh`) on phones. Sections: My account, Voice & audio, Notifications, Appearance, then Site admin.
- My account has the avatar, name and email, a Status card (presence word, custom status, **Edit status** opening the existing status dialog over Settings) and **Sign out**.
- Footer: the sign-out icon is now a **Settings** gear. Sign out is the last item of the status menu.
- **Deviation:** the section is still called "Voice & audio", not "Voice & video". There are no camera settings, so "video" would promise something that isn't there.
- Site admin sections are unchanged inside (still checkboxes): P5-03 reshapes them.
- Existing tests changed only where the design changed:
  - `ProfileDialog.test.jsx`: the tab names and order; the phone-strip test is replaced by the fixed-size/full-screen test; new tests for My account and switches.
  - `NotificationSettings.test.jsx` and `touchTargets.test.jsx`: `checkbox` → `switch`, and the footer's `Sign out` → `Settings`.

## Discovered Work (not done here)
- `web/src/index.css` defines the `tap`/`tap-row`/`tap-chip`/`tap-reaction` utilities twice (two identical blocks). Harmless, worth a one-line cleanup.
- The worktree dev server can't serve the fonts that live behind the `node_modules` junction (403 from Vite's `fs.allow`). This only affects the sandbox technique, not the app.

## Verification Evidence
| Acceptance Criterion | Status | Verification Type | Evidence |
|---|---|---|---|
| AC-1 | Verified | Sandbox (server :3005, this branch's dev server :5175), 1024×768 | Clicked all six sections in turn and measured: the list stayed at x128 y113 224×598 and the window at 768×653 every time. Before: the window re-centred per section (`shots/02-settings-audio-jump.jpg`). `shots/p5-02-my-account.jpg`, `p5-02-image-generation.jpg` |
| AC-2 | Verified | Sandbox at 375×812 + `SettingsKit.test.jsx` | Settings fills the screen (812 px), opens on the list (`shots/p5-02-phone-list.jpg`). Tapping a section opens its page (`p5-02-phone-page.jpg`, taken before the back bar's label became "All settings"). Back button → list; `history.back()` → list with Settings still open and focus on the section's row. Page width 375, no sideways scroll |
| AC-3 | Verified | Sandbox + tests | Join/leave sounds, Push-to-talk, push, message text and message sounds are `role="switch"`. In the sandbox Space toggled Join/leave sounds off and on (the `disgourd.voiceSounds` setting followed). `shots/p5-02-voice-audio-switches.jpg`, `p5-02-notifications.jpg` |
| AC-4 | Verified | Sandbox + `UserFooterGear.test.jsx` | The footer shows the gear (`shots/p5-02-footer-gear.jpg`), which opens Settings. Sign out from the status menu (`p5-02-status-menu-sign-out.jpg`) and from My account each went back to the sign-in screen. Edit status opens the status dialog over Settings (`p5-02-edit-status.jpg`) |
| AC-5 | Verified | Vitest | Tablist keys, `initialSection`, the remembered section and admin gating: the existing `ProfileDialog` tests pass with the new names. Full web suite 84 files / 697 tests green; `vite build` clean |
| AC-6 | Verified | Test | `ProfileDialog.test.jsx`: a member sees no Site admin group; an admin does (sandy in the sandbox) |
