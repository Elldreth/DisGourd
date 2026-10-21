# P10-02 — Privacy & safety page, device list order and limit, Log out wording

- **Unit Type:** Implementation (child of P10-00)
- **Phase:** 10
- **State:** COMPLETE (merged #203)
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
- [x] AC-1: My account's scroll height is under 900 px with 15 devices (they moved).
- [x] AC-2: this device is the first row; with more than 6 sessions, only 5 others show until "Show n more".
- [x] AC-3: the button that logs you out reads "Log out"; device buttons keep "Sign out".
- [x] AC-4: phone list → page works for the new section, with Back.
- [x] AC-5: the existing Devices and blocking tests pass, updated for the new location.

## Expected Areas of Change
ProfileDialog.jsx, settings/DevicesSection.jsx, settings/BlockedSection.jsx, a new settings/PrivacySection.jsx, tests.

## As built
- **A new section, Privacy & safety** (`ProfileDialog`), after My account, holds Signed-in devices and Blocked people.
- **My account** keeps the avatar, status, password and **Log out**. The button has the log-out icon, and the status menu's last item says "Log out" too, so neither reads like signing out a device.
- **`DevicesSection`:**
  - This device comes first, then the others by activity, five of them, then "Show n more".
  - `deviceLabel()` shows "Unknown browser" for a sign-in with no browser name. The stored label is unchanged.
  - The "Signed in … · Active …" line wraps instead of being cut off on phones.
  - The "This device" tag is a lime outline instead of a tint. The tint failed contrast in the light theme (3.96:1, axe serious; it dates from P9-03).
- **`BlockedSection`:** an empty list shows the shield mascot (the P10-08 "privacy" pose, now `EmptyState` art `privacy`).
- **Decision 4 (the optional "Blocked on …" date)** was left out, so this pass has no server change.
- **Older tests updated** for the new tab, the moved lists and the wording: ProfileDialog (5 tabs), SiteAdminPages (the admin tabs start at index 5), UserFooterGear ("Log out").

## Verification Evidence
| Acceptance Criterion | Status | Verification Type | Evidence |
|---|---|---|---|
| AC-1 | Verified | Sandbox (this branch's app on :5175, sandy with 18 sessions) | My account's scroll height is 625 px, the panel's own height, so it doesn't scroll (it was 1,627) (`shots/p10-02-my-account.jpg`) |
| AC-2 | Verified | `Devices.test.jsx` + sandbox | This device first, five others, "Show 12 more" (`shots/p10-02-privacy.jpg`) |
| AC-3 | Verified | Tests | My account and the status menu say "Log out"; the device buttons say "Sign out <device>" |
| AC-4 | Verified | Sandbox 375×812 | List → Privacy & safety with Back (`shots/p10-02-phone.jpg`) |
| AC-5 | Verified | Vitest | Devices, blocking, ProfileDialog, SiteAdminPages and UserFooterGear pass |
| Accessibility | Verified | axe-core 4.10.2 | My account and Privacy & safety: no violations in dark or light, after the "This device" fix (`shots/p10-02-privacy-light.jpg`) |
| Suites | Verified | Vitest, Jest, Vite | Web 104 files / 824 tests; server 53 suites / 461 tests; `vite build` clean |

## kie.ai spend
None.

## Not in scope
Anything not listed above. Other findings in the review belong to their own pass.
