# P12-04 — Security notices: password changed, email changed, new device

- **Unit Type:** Implementation (child of P12-00)
- **Phase:** 12
- **State:** PLANNED
- **Effort:** S
- **Depends on:** P12-02 (confirmed addresses)
- **Serialize with:** none; P12-03 can run in parallel
- **Requirement Source:** P12-00 owner decision 2.

## Problem
If someone else signs in to an account or changes its password, the owner of the account finds out only when they're locked out.

## Scope
Each notice goes only to a **confirmed** address and says what happened, when, and on which device. The device is the session's label, like "Chrome on Windows"; no IP addresses are shown or stored, matching P9-03. Each ends with "If this wasn't you, reset your password" (a link to the forgot screen) and a link to Settings › Privacy & safety › Devices.

| Event | Sent to | Can be turned off |
|---|---|---|
| Password changed (in Settings, or through a reset) | the confirmed address | no |
| Email changed or removed | the **old** confirmed address ("Your email was changed to b•••@example.com") | no |
| New device signed in (a new `sessions` row at login) | the confirmed address | yes, in Settings › Notifications › Email ("Tell me when a new device signs in", on by default) |

- **New device:** not sent for the first session of a brand-new account, nor for a sign-in from a device label seen in the last 30 days, so the same browser signing in again doesn't nag. At most one an hour per account.
- **The setting** is stored per user (`users.notify_new_device`, or the existing per-user settings store if one fits). It goes into P12-02's migration if built together; otherwise the next free version.
- **Admin actions** (an admin reset link being *made*) send nothing. Using it sends "Password changed".

## Acceptance criteria
- [ ] AC-1: changing the password in Settings and through a reset each send one notice, to the confirmed address only.
- [ ] AC-2: changing the email notifies the old address with the new one masked. Removing it notifies the old address.
- [ ] AC-3: the new-device notice is sent for a new label, not for a label seen in the last 30 days, not for a brand-new account, at most one an hour, and never when the setting is off.
- [ ] AC-4: no notice when email is off, or the account has no confirmed email. Requests behave the same as without notices.
- [ ] AC-5: the template snapshots show the device label, the time in UTC with the server's name, and no IP addresses or tokens.
- [ ] AC-6: Vitest covers the Settings switch. axe is clean.
- [ ] AC-7: sandbox check with real email: sign in from a second browser and receive "New sign-in to your account".

## Expected Areas of Change
`server/routes/auth.js` (login, `/me/password`, `/me/email`), `server/mail/templates.js`, `server/db/index.js` (seen device labels, the setting), the Notifications settings page, `api.js`; tests.

## Not in scope
Notices for admin actions on someone else's account, sign-in alerts by push notification, and a weekly security summary.
