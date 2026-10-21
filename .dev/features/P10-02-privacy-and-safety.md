# P10-02 — Privacy & safety page, device list order and limit, Log out wording

- **Unit Type:** Implementation (child of P10-00)
- **Phase:** 10
- **State:** PLANNED
- **Effort:** S–M
- **Depends on:** P10-00 (decision 2)
- **Serialize with:** none
- **Requirement Source:** `design/design-review-p10/REVIEW.md` A1–A3.

## Scope
- A new user-settings section, **Privacy & safety**, after My account, holding Signed-in devices and Blocked people (moved from My account).
- My account keeps profile, status, password and **Log out** (renamed from "Sign out").
- Devices: this device first with its lime tag. Then the others by activity, five shown, then "Show n more". "Unknown device" becomes "Unknown browser".
- Optional (decision 4): "Blocked Oct 20" under each blocked person needs `created_at` from GET /blocks.

## Acceptance criteria
- [ ] AC-1: My account's scroll height is under 900 px with 15 devices (they moved).
- [ ] AC-2: this device is the first row; with more than 6 sessions, only 5 others show until "Show n more".
- [ ] AC-3: the button that logs you out reads "Log out"; device buttons keep "Sign out".
- [ ] AC-4: phone list → page works for the new section, with Back.
- [ ] AC-5: the existing Devices and blocking tests pass, updated for the new location.

## Expected Areas of Change
ProfileDialog.jsx, settings/DevicesSection.jsx, settings/BlockedSection.jsx, a new settings/PrivacySection.jsx, tests.

## Not in scope
Anything not listed above. Other findings in the review belong to their own pass.
