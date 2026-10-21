# P12-02 — Email addresses: optional, confirmed by a link, changed with your password

- **Unit Type:** Implementation (child of P12-00)
- **Phase:** 12
- **State:** COMPLETE (merged in #234; AC-8 checked live on 2026-10-21)
- **Starting baseline:** main after #233
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

## As built
- **Migration v35 (`foreignKeysOff: true`):**
  - **The rebuild:** the users table is rebuilt from its own `CREATE` statement, with `NOT NULL` dropped from `email` only. The steps: copy every row with `SELECT *`, drop the old table, rename the new one, then recreate the table's indexes and triggers (including P11-12's NOCASE indexes).
  - **The runner** now switches foreign keys off around such a migration and back on afterwards. It runs `foreign_key_check` inside the transaction, so any broken foreign key rolls the migration back.
  - **Older databases** whose `email` column was added later (already nullable) aren't rebuilt.
  - **New:** `users.email_verified_at`, and `email_tokens` with an index on (user_id, purpose).
- **`db`:** `createEmailToken` (32 random bytes, base64url; only the SHA-256 is stored; earlier unused tokens for that purpose are retired), `useEmailToken` (one atomic `UPDATE ... RETURNING`), `pendingEmail`, `emailConfirmedElsewhere`, `confirmUserEmail` (a transaction: a confirmed claim elsewhere means 'taken', and an unconfirmed claim elsewhere is cleared), `setUserEmail`, `emailConfirmRequired`.
- **`server/routes/email.js`:**
  - `POST /me/email` (password, with the `/me/password` limiter): a bad address and one confirmed elsewhere get the **same** 400.
    - **Email on:** the link goes out, the address waits, and the answer is 202 with `emailPending`.
    - **Email off:** the address is stored unconfirmed (refused if another account holds it).
  - `DELETE /me/email` (password): answers 409 while the switch is on, unless you're a site admin.
  - `POST /me/email/resend`: 3 an hour.
  - `POST /email/confirm`: 20 per 15 minutes per address. 400 `TOKEN_INVALID`, 409 `TAKEN`.
  - Logs show only the domain.
- **Sign-up:** the email is optional (empty or blank means none). It's required when the gate is active, except for the first account. A given address gets its link straight away.
- **`/auth-info`** adds `email` and `emailRequired`. **`GET /me`** adds `email`, `emailVerified`, `emailPending` and `emailConfirmRequired`.
- **`server/auth/emailGate.js` (the gate):**
  - **When it applies:** only while the switch is on **and** email works. Site admins and bots are never held back.
  - **HTTP:** `http/handler.js` answers 403 `EMAIL_UNCONFIRMED` to any request with a token except `/me`, `/me/email`, `/me/email/resend`, `/logout`, `/email/confirm` and `/auth-info`.
  - **The live connection:** `gateway/index.js` closes the socket with **4003** before admitting it.
- **Admin:** `PUT /admin/email { requireConfirmed }` answers 409 while email is off. `GET` adds `requireConfirmed`.
- **Template:** `confirmEmail` ("Confirm your email for <server>", one button, "works once, 24 hours").
- **Web:**
  - **Sign-up:** "Email (optional, for password reset)", or required with "You'll get a link to confirm it"; the setup wizard says the same.
  - **`settings/EmailSection.jsx`** in My account: the address with Confirmed or Not confirmed; Add, Change or Remove with your password; "Waiting for you to open the link sent to ..." with "Send a new link".
  - **`emailLink.js`** reads `#confirm-email=...` once and cleans the address bar. **`ConfirmEmailLink.jsx`** posts it once, then shows "Email confirmed" (party mascot) or "That link didn't work" with a new link.
  - **`ConfirmEmailGate.jsx`:** says "We sent a link to ..." only when a link is out; otherwise "... isn't confirmed yet" with "Send a confirmation link". Also "Use a different address" (with your password), "I've opened the link" and Sign out.
  - **`App.jsx`** shows the gate (no live connection while it's up) and asks `/me` again when a 403 `EMAIL_UNCONFIRMED` arrives.
  - **Site admin › Email** gets the "Require a confirmed email" switch, off while email is off.
- `/email` is added to `web/devProxy.js`.

## Acceptance criteria
- [x] AC-1: the migration keeps every user, session, message and foreign key (`foreign_key_check` is empty) on a copy of the sandbox DB. Existing emails come out unconfirmed, and a NULL email is allowed afterwards.
- [x] AC-2: sign-up without an email works with the switch off, and is refused with it on.
- [x] AC-3: changing the email needs the right password. The address doesn't change until the link is used, and the link confirms only the address it was sent to.
- [x] AC-4: a token works once, expires after 24 hours, and is stored only as a hash (a test reads the row).
- [x] AC-5: an address already confirmed by another account is refused, with the same wording as for an invalid address, so whether it's in use isn't revealed.
- [x] AC-6: with the switch on, an unconfirmed member sees only the confirm step, and API calls answer 403 `EMAIL_UNCONFIRMED` except `/me`, `/me/email*`, `/logout` and `/email/confirm`. A site admin isn't blocked.
- [x] AC-7: the web flows (add, change, resend, remove, confirm from a link while signed out) have Vitest coverage. axe is clean on the new screens.
- [x] AC-8: sandbox check with real email: add an address, click the link from the inbox, see "Confirmed".

## Expected Areas of Change
`server/db/migrations.js` and `server/db/index.js`, `server/routes/auth.js` (or a new `server/routes/email.js`), `server/validate.js`, `server/mail/templates.js` ("Confirm your email"), `web/devProxy.js`; web: `Login.jsx` (sign-up), `SetupWizard.jsx`, `ProfileDialog.jsx` (a new `settings/EmailSection.jsx`), a new `ConfirmEmailGate.jsx`, `App.jsx` (the `#confirm-email=` link), `api.js`, the admin Email page; tests.

## Not in scope
Password reset (P12-03). Notices (P12-04). Several addresses per account.

## Evidence (2026-10-21)
| Criterion | Evidence |
|---|---|
| AC-1 | `db-migrations.test.js` "P12-02 (v35)": built at v34 with users and sessions, then migrated. Every row is kept, sessions are intact, `foreign_key_check` is empty and foreign keys are back on. `email` is nullable, the NOCASE indexes are back (a case-twin username is still refused), and the cascade from users to sessions still works. **On a copy of the real sandbox DB (v32 to 35):** users 6, messages 880, sessions 49, dm_messages 158 and space_members 7, all unchanged. `foreign_key_check` 0, and a NULL email was saved afterwards |
| AC-2 | `email-addresses.test.js`: sign-up with no email or a blank one gives 201 with `email: null`; a bad one says "Enter a valid email address, or leave it empty"; with the switch on: "An email address is required on this server" |
| AC-3 | A wrong password gives 403. With the right one: 202, `emailPending` is the new address, and `users.email` is unchanged until the link. The earlier link is retired. The link confirms exactly the address it was sent to |
| AC-4 | The link works once (the second try gives 400 `TOKEN_INVALID`). An `expires_at` in the past gives 400. The table holds only a hash: neither the raw token nor its text appears in any `email_tokens` row |
| AC-5 | A bad address and one confirmed by another account answer the same 400 "That email address can't be used". An unconfirmed claim gives way, and the other account's address is cleared |
| AC-6 | With the switch on, `/spaces` answers 403 `{ code: 'EMAIL_UNCONFIRMED' }`, `/me` says `emailConfirmRequired: true`, removing the address answers 409, and the socket closes with **4003**. The site admin isn't held back. After confirming, `/spaces` answers 200. With email off, nobody is held back. The switch can't be turned on while email is off (409), and a member gets 403 |
| AC-7 | `emailAddresses.test.jsx` (8 tests): the sign-up field, add/resend, change/remove (with a wrong password), the link page both ways, the address-bar capture, the gate (both wordings, a new link, check again, another address, sign out), the admin switch, and every control named in words (the a11y harness's check). The sandbox can't load axe from the CDN under P11-06's CSP |
| Suites | Server 642 tests (2 Linux-only skipped), web 872 tests; `vite build` clean |
| Sandbox (AC-8 stand-in) | A throwaway copy of the sandbox DB on :3012, with a test-only transport that prints each email to the log. **bob:** Settings › My account › Email showed "bob@example.test · Not confirmed" → Change → a new address plus password → "We sent a link to ...", "Waiting for you to open the link...". The log had the email with its link. Opening the link → **"Email confirmed"**, the address bar cleaned, and the server log showed only the domain. **cara (switch on, as sandy):** `/spaces` answered 403 `EMAIL_UNCONFIRMED`, and the app showed "Confirm your email". It first said "We sent a link" when none had been sent, so the wording was fixed to "isn't confirmed yet" with "Send a confirmation link". Then the link was sent, opened ("Email confirmed") and Continue chosen → the app loaded and `/spaces` answered 200. The temporary entry and DB were removed |
| AC-8 (live) | **The owner's Unraid server (2026-10-21):** after the update (migration v35 ran on start), Settings › My account › Email → send a confirmation link → the email arrived → its link opened DisGourd's "Email confirmed" → the address then showed **Confirmed** |
