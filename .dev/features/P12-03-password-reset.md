# P12-03 — Password reset: "Forgot password?" and an admin reset link

- **Unit Type:** Implementation (child of P12-00)
- **Phase:** 12
- **State:** REVIEW
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
  - Recorded in the server log ("[admin] owner made a reset link for bob"), never the link itself. There's no admin audit log yet; if one is added later, this goes there.
  - A site admin can't make one for another site admin (the owner resets their own via email or the server console).
- **Server console fallback:** `node server/tools/reset-link.js <username>` prints a link, for the owner locked out of the only admin account. Run it with `docker exec`; it uses the same token code. Documented in the README.
- **`/auth-info`** adds `email: <bool>`.
- Add `/password` to `web/devProxy.js` `apiPaths`.

## Acceptance criteria
- [x] AC-1: forgot with an unknown name, an account without email, an unconfirmed email and a confirmed one: the same response body and status, and only the last sends mail. A test checks the bodies and that the response time doesn't depend on which case it is (a loose bound).
- [x] AC-2: the reset token works once and expires after 30 minutes. Asking again invalidates the earlier link.
- [x] AC-3: after a reset, every old token and session is rejected (HTTP and the socket). The resetting device is signed in.
- [x] AC-4: limits: the 6th forgot from one IP within 15 minutes → 429 with the same wording as other limits. The 4th email to one account within an hour isn't sent, and the response doesn't change.
- [x] AC-5: an admin reset link: only for site admins, never for another site admin, shown once, 24 hours, single use, logged without the token.
- [x] AC-6: the console tool prints a working link for a named user and refuses an unknown name.
- [x] AC-7: tokens never appear in server logs (a test captures the logs during the full flow).
- [x] AC-8: Vitest covers forgot (the hidden link when email is off), reset (success, expired, mismatch) and the admin dialog. axe is clean.
- [ ] AC-9: sandbox check with real email: forgot → the email arrives → the link → a new password → the other tab is signed out.

## Expected Areas of Change
`server/routes/auth.js` (or `server/routes/password.js`), `server/db/index.js` (token helpers shared with P12-02), `server/mail/templates.js` ("Reset your password"), `server/routes/admin.js`, a new `server/tools/reset-link.js`, `web/devProxy.js`; web: `Login.jsx`, a new `ResetPassword.jsx`, `App.jsx` (the `#reset=` link), `RegistrationAdmin.jsx` or a new Reset links card on the General page, `api.js`; README; tests.

## As built (differences from the plan)
- **The admin link lives in Site admin › People** (P11-09 added the member search after this packet was written), as a **Reset link** button on each account that isn't a site admin, behind a confirm step. The packet foresaw this ("if a member list arrives later…"); there's no separate card on General.
- **The console tool is `server/scripts/reset-link.js`**, next to `print-secrets-env.js`, not a new `server/tools/` folder.
- **The routes live in `server/routes/password.js`.** `db.peekEmailToken` lets the reset check the new password's strength (P11-08) *before* spending the link, so a weak choice doesn't waste it.
- **The forgot answer is padded to at least 400 ms** in every case, so its timing doesn't tell whether the account exists.
- **"Forgot password?" sits under the password field**, not in its label, so the field's accessible name stays "Password".
- **A link pasted into a tab that's already open** (only the `#` part changes, so the page doesn't reload) is picked up too; the same goes for confirmation links.
- **No axe library in this repo:** AC-8's accessibility is checked through role and label queries (every control named) instead.

## Evidence (2026-10-21)
| Criterion | Evidence |
|---|---|
| AC-1 | `password-reset.test.js`: a confirmed address (by name and by address, any case), an unconfirmed one, no address, an unknown name and an unknown address, and an empty value all get 200 and the same body; each takes at least ~400 ms; only the confirmed address gets mail. With email off: the same answer, nothing sent |
| AC-2 | Asking twice: the first link is refused. Used once, then refused. An expired token and a confirm-email token are both refused (`TOKEN_INVALID`) |
| AC-3 | A socket open before the reset gets `signed_out` and closes with 4001; the old token gets 401 on `/me`; the old password is refused and the new one works; the reset returns a fresh token that works. A suspended account gets `{ ok, suspended }` and no sign-in |
| AC-4 | With limits on: the 6th forgot from one IP → 429 "Too many attempts. Please try again later."; the 21st reset → 429; four forgot requests for one account send 3 emails, and all four get the same answer |
| AC-5 | Site admin → 201 `{ path: '/#reset=…', expiresInHours: 24 }`, the token's lifetime is exactly 24 h, the log says "[admin] owner made a reset link for noel" without the token, and the link works. A member → 403, signed out → 401, another site admin → 403 with the reason, an unknown name → 404. Web: the button isn't offered for site admins, asks first, then shows the full link once with Copy, and Done hides it |
| AC-6 | The test runs the script on a temp DB: it prints "A reset link for kim (works once, for 24 hours):" and `https://chat.example.com/#reset=<43 chars>` (the trailing slash of `PUBLIC_URL` dropped); "ghost" → exit 1, "No account named \"ghost\"." |
| AC-7 | All `console.warn` output is captured during the tests: it names the account and the address's domain only, never a token or the full address |
| AC-8 | `passwordReset.test.jsx` (8 tests): the link shows only when email works and only on sign-in; the username carries over; the server's answer shows; the link is read once from the address bar; mismatched passwords; a weak one can be retried; a dead link; suspended; signed-in wording; the People flow |
| Suites | Server 665 (2 Linux-only skipped), web 886; `vite build` clean |
| AC-9 (sandbox) | A throwaway copy of the sandbox DB on :3012 with email set up and a test-only transport printing each email. bob given a confirmed address. Sign-in page → **Forgot password?** → "bob" → the same-for-everyone answer and "No email address on the account? Ask a site admin for a reset link.". The log had "Reset your DisGourd password" with the link. bob signed in on a second tab first; opening the link → "Choose a new password" → set → this tab entered the app as bob, and the other tab went to sign-in with "Your password was changed on another device, so you were signed out here.". The same link again → "That link didn't work". As sandy: Site admin › People → cara → **Reset link** → confirm → the full link (43-character token) with Copy; using it set cara's password and she could sign in. Server log lines: "[password] reset link sent for user 2 to …@example.com", "[admin] sandy made a reset link for cara", "[password] user 3 reset their password", no tokens. The temporary entry and DB were removed |
| AC-9 (live) | To do after merging: on the owner's server, Forgot password with the owner's confirmed address, the real email arrives, and the link works |

## Discovered Work
- None new. (Still open from earlier: less spam-like email; the server icon on the invite landing page.)

## Not in scope
Security questions, SMS, two-factor.
