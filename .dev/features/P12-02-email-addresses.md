# P12-02 — Email addresses: optional, confirmed by a link, changed with your password

- **Unit Type:** Implementation (child of P12-00)
- **Phase:** 12
- **State:** PLANNED
- **Effort:** M
- **Depends on:** P12-01 (sending), P11-12 (case-insensitive emails; this builds on its NOCASE index)
- **Serialize with:** P11-12 (both change the users table)
- **Requirement Source:** P12-00 owner decisions 3 and 4.

## Problem
An email is required at sign-up but never confirmed, so it can't be trusted for password reset. And it can't be added later or changed.

## Scope
- **A migration (the next free version):**
  - Rebuild `users` so `email` may be NULL. Keep the NOCASE unique index from P11-12, which allows any number of NULLs.
  - Add `email_verified_at INTEGER` (NULL = not confirmed).
  - Store existing addresses as they are, all unconfirmed.
  - New table `email_tokens(id, user_id → users ON DELETE CASCADE, purpose TEXT, token_hash TEXT UNIQUE, email TEXT, created_at, expires_at, used_at)`. `purpose` is `confirm` or `reset`; P12-03 uses `reset`.
  - See P12-00 "Migration" for the rebuild steps.
- **Sign-up:**
  - The email field becomes optional, labelled "Email (optional, for password reset)".
  - When `require confirmed email` is on, the field is required, and the new account can't use the app until it's confirmed (see below).
- **Settings › My account › Email:**
  - **Shows** the address with "Confirmed" or "Not confirmed · Resend link", or "No email · Add one".
  - **Adding or changing** an address asks for the current password (the same check and limiter as `/me/password`).
    - The new address is held in the token row; `users.email` doesn't change until the link is clicked.
    - So a typo can't lock anyone out, and someone holding a stolen session can't silently move the account's email.
  - **Remove email**, with the password. It isn't offered while the switch is on.
- **The confirmation link** is `PUBLIC_URL/#confirm-email=<token>`, valid for 24 hours. Opening it while signed in or out posts the token to `/email/confirm`. Success sets `email` and `email_verified_at` and shows "Email confirmed". Expired and used tokens show a clear message with "Send a new link".
- **The admin switch** is "Require a confirmed email" on Site admin › Email:
  - Off by default, and it can only be turned on when email is set up.
  - When on, accounts without a confirmed address see a full-screen "Confirm your email" step after signing in (add or resend, sign out). Site admins are exempt, so the owner can't lock themselves out.
- **Routes:**
  - `GET /me` adds `emailVerified`.
  - `POST /me/email { email, password }` sends a confirmation to the new address.
  - `DELETE /me/email { password }` removes the address.
  - `POST /me/email/resend` resends the link.
  - `POST /email/confirm { token }` confirms; no sign-in needed.
  - Add `/email` to `web/devProxy.js` `apiPaths`.
- **Limits:**
  - Resend: 3 an hour per account.
  - Confirm: 20 tries per IP per 15 minutes (the shared limiter).
  - Old tokens for the same purpose are invalidated whenever a new one is issued.

## Acceptance criteria
- [ ] AC-1: the migration keeps every user, session, message and foreign key (`foreign_key_check` is empty) on a copy of the sandbox DB. Existing emails come out unconfirmed, and a NULL email is allowed afterwards.
- [ ] AC-2: sign-up without an email works with the switch off, and is refused with it on.
- [ ] AC-3: changing the email needs the right password. The address doesn't change until the link is used, and the link confirms only the address it was sent to.
- [ ] AC-4: a token works once, expires after 24 hours, and is stored only as a hash (a test reads the row).
- [ ] AC-5: an address already confirmed by another account is refused, with the same wording as for an invalid address, so whether it's in use isn't revealed.
- [ ] AC-6: with the switch on, an unconfirmed member sees only the confirm step, and API calls answer 403 `EMAIL_UNCONFIRMED` except `/me`, `/me/email*`, `/logout` and `/email/confirm`. A site admin isn't blocked.
- [ ] AC-7: the web flows (add, change, resend, remove, confirm from a link while signed out) have Vitest coverage. axe is clean on the new screens.
- [ ] AC-8: sandbox check with real email: add an address, click the link from the inbox, see "Confirmed".

## Expected Areas of Change
`server/db/migrations.js` and `server/db/index.js`, `server/routes/auth.js` (or a new `server/routes/email.js`), `server/validate.js`, `server/mail/templates.js` ("Confirm your email"), `web/devProxy.js`; web: `Login.jsx` (sign-up), `SetupWizard.jsx`, `ProfileDialog.jsx` (a new `settings/EmailSection.jsx`), a new `ConfirmEmailGate.jsx`, `App.jsx` (the `#confirm-email=` link), `api.js`, the admin Email page; tests.

## Not in scope
Password reset (P12-03). Notices (P12-04). Several addresses per account.
