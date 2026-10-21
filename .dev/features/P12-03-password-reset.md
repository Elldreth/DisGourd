# P12-03 — Password reset: "Forgot password?" and an admin reset link

- **Unit Type:** Implementation (child of P12-00)
- **Phase:** 12
- **State:** PLANNED
- **Effort:** M
- **Depends on:** P12-02 (confirmed addresses, `email_tokens`). P11-08 is soft (its per-account and per-IP limiter; use the current one if P11-08 hasn't landed).
- **Serialize with:** P12-04 can run in parallel; it touches different routes.
- **Requirement Source:** P12-00 owner decisions 2 and 4.

## Problem
A forgotten password today means a lost account, and the only fix is for an admin to remove it.

## Scope
- **Login page:**
  - A "Forgot password?" link, shown only when `/auth-info` says `email: true` (email is set up).
  - It asks for a username or email and always answers: "If that account has a confirmed email, a reset link is on its way. It expires in 30 minutes."
- **`POST /password/forgot { login }`:**
  - Finds the account case-insensitively. If it has a confirmed email, it issues a `reset` token (30 minutes, single use), invalidating any earlier reset token, and queues "Reset your password".
  - The answer is identical in every case. A short fixed delay plus constant-time work hide whether the account exists, both in the timing and in the reply.
  - Limits: 5 per IP per 15 minutes, and 3 emails per account per hour.
- **The reset link** is `PUBLIC_URL/#reset=<token>`. It opens a "Choose a new password" screen (new password and repeat, with the same length rules as today).
- **`POST /password/reset { token, newPassword }`:**
  - Valid → set the password, mark the token used, end **every** session for the account (bump `token_version`, delete all `sessions` rows) and sign in on this device with a fresh session.
  - Invalid, expired or used → 400 "This link has expired or was already used", with "Send a new one".
- **Admin reset link:** for accounts with no confirmed email, or when email is off.
  - Site admin › General gets a **Reset links** card: type a username → **Make a reset link** → a confirm step → the link appears once, with Copy. It's valid for 24 hours, single use, and the admin hands it over themselves.
    - There's no site-wide member list yet, so typing the name is the way in.
    - If a member list arrives later, it gets the same action in each user's menu.
  - Making a link doesn't sign the user out; using it does.
  - Recorded in the server log ("[admin] elldreth made a reset link for bob"), never the link itself. There's no admin audit log yet; if one is added later, this goes there.
  - A site admin can't make one for another site admin (the owner resets their own via email or the server console).
- **Server console fallback:** `node server/tools/reset-link.js <username>` prints a link, for the owner locked out of the only admin account. Run it with `docker exec`; it uses the same token code. Documented in the README.
- **`/auth-info`** adds `email: <bool>`.
- Add `/password` to `web/devProxy.js` `apiPaths`.

## Acceptance criteria
- [ ] AC-1: forgot with an unknown name, an account without email, an unconfirmed email and a confirmed one: the same response body and status, and only the last sends mail. A test checks the bodies and that the response time doesn't depend on which case it is (a loose bound).
- [ ] AC-2: the reset token works once and expires after 30 minutes. Asking again invalidates the earlier link.
- [ ] AC-3: after a reset, every old token and session is rejected (HTTP and the socket). The resetting device is signed in.
- [ ] AC-4: limits: the 6th forgot from one IP within 15 minutes → 429 with the same wording as other limits. The 4th email to one account within an hour isn't sent, and the response doesn't change.
- [ ] AC-5: an admin reset link: only for site admins, never for another site admin, shown once, 24 hours, single use, logged without the token.
- [ ] AC-6: the console tool prints a working link for a named user and refuses an unknown name.
- [ ] AC-7: tokens never appear in server logs (a test captures the logs during the full flow).
- [ ] AC-8: Vitest covers forgot (the hidden link when email is off), reset (success, expired, mismatch) and the admin dialog. axe is clean.
- [ ] AC-9: sandbox check with real email: forgot → the email arrives → the link → a new password → the other tab is signed out.

## Expected Areas of Change
`server/routes/auth.js` (or `server/routes/password.js`), `server/db/index.js` (token helpers shared with P12-02), `server/mail/templates.js` ("Reset your password"), `server/routes/admin.js`, a new `server/tools/reset-link.js`, `web/devProxy.js`; web: `Login.jsx`, a new `ResetPassword.jsx`, `App.jsx` (the `#reset=` link), `RegistrationAdmin.jsx` or a new Reset links card on the General page, `api.js`; README; tests.

## Not in scope
Security questions, SMS, two-factor.
