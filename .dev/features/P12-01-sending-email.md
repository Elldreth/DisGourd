# P12-01 — Sending email: SMTP settings, mailer, "Send test email"

- **Unit Type:** Implementation (child of P12-00)
- **Phase:** 12
- **State:** PLANNED
- **Effort:** S–M
- **Depends on:** P11-14 (soft: the `_FILE` helper for secrets; if it hasn't landed, add the same small helper here)
- **Serialize with:** none
- **Requirement Source:** P12-00 owner decision 1 (Resend over SMTP 587).

## Problem
The server can't send email. Everything else in P12 needs a reliable way to send mail that never leaks its credentials and never slows down a request.

## Scope
- **Configuration**, from the environment only:

  | Variable | Example | Notes |
  |---|---|---|
  | `SMTP_HOST` | `smtp.resend.com` | Email is off when unset |
  | `SMTP_PORT` | `587` | 587 uses STARTTLS (required, never falls back to plain); 465 uses TLS from the start |
  | `SMTP_USER` | `resend` | |
  | `SMTP_PASS` / `SMTP_PASS_FILE` | the Resend API key | Never logged, returned or stored |
  | `MAIL_FROM` | `DisGourd <no-reply@2108464.xyz>` | Required. Must be on a domain verified with the provider |
  | `MAIL_REPLY_TO` | `admin@2108464.xyz` | Optional |
  | `PUBLIC_URL` | `https://disgourd.2108464.xyz` | Required for links. Email is off without it |

- **Mailer (`server/mail/index.js`):**
  - Uses **nodemailer**: one well-known, dependency-free package, rather than writing SMTP by hand. The pinned version is added to `server/package.json`, and `npm audit` stays clean.
  - `mail.enabled()` and `mail.send({ to, subject, text, html })` → queued.
  - **Queue:** in memory, one send at a time, 3 attempts (back-off 1 min / 5 min / 30 min).
  - **Daily cap** (`MAIL_DAILY_LIMIT`, default 90, under Resend's free 100/day). Beyond it, mail is dropped with a log line and a counter on the admin page.
  - **Per recipient:** at most 5 an hour, so the server can't be used to flood one inbox.
  - **Headers:** `Message-ID`, `Date`, and `Auto-Submitted: auto-generated`.
  - **Pending mail:** lost on restart, which is acceptable (the person can ask again).
  - **Logs:** status lines carry the recipient's domain only, never the full address, and never the token.
- **Templates (`server/mail/templates.js`):**
  - One function per email, returning `{ subject, text, html }`.
  - A shared layout: the server name, the message, a single button-style link, and a footer ("You're getting this because you have an account on <server>").
  - Inline CSS, no images, all values escaped. Template tests use snapshots.
- **Site admin › Email** (a new settings page under the Site admin group, after General):
  - **Status:**
    - "Email is set up: sending from no-reply@… via smtp.resend.com:587"
    - or "Email is off", with which variables are missing (names only, never values).
  - **Today:** sent, failed and over-the-cap counts, plus the last error message (with the password removed).
  - **Send test email:** sends to the admin's own confirmed address, or to an address typed in the box for the very first test. Rate limited to 5 an hour.
  - **The "require confirmed email" switch** is added here in P12-02.
- **Routes:**
  - `GET /admin/email` returns the status.
  - `POST /admin/email/test` sends the test email.
  - Both are for site admins only. They sit under `/admin`, which `devProxy.js` already forwards; check that it does.
- **Docs** (README, "Email"):
  1. Resend: add and verify the domain, then create a "sending only" API key.
  2. Cloudflare DNS: Resend's SPF (TXT on `send`), DKIM (`resend._domainkey`) and MX for bounces, plus a DMARC record (`_dmarc`, `p=none` to start, then `quarantine`).
  3. Optional: Cloudflare Email Routing for `admin@` → your own mailbox.
  4. The compose `environment:` lines, with `SMTP_PASS_FILE` pointing at a file next to the stack (mode 600).
  5. If port 587 is blocked by your ISP, use 2587.

## Acceptance criteria
- [ ] AC-1: with no SMTP variables, `mail.enabled()` is false, the admin page says "Email is off" and names the missing variables, and nothing tries to send.
- [ ] AC-2: with a fake SMTP server (nodemailer's stream transport, or a local test server in Jest), "Send test email" delivers one message with both text and HTML parts, the right From, and a link built from `PUBLIC_URL`.
- [ ] AC-3: the password never appears in any response, log line or error shown on the admin page (a test greps the captured output).
- [ ] AC-4: a failed send is retried up to 3 times and then recorded as failed. The request that queued it got its answer immediately.
- [ ] AC-5: the daily cap and the per-recipient limit hold, and the admin page shows the counts.
- [ ] AC-6: non-admins get 403 from both routes.
- [ ] AC-7: port 587 refuses to send without STARTTLS (`requireTLS`).
- [ ] AC-8: live check in the sandbox with the owner's Resend key: a test email arrives in the owner's inbox. Note whether it landed in spam, and check SPF/DKIM/DMARC "pass" in the message headers.

## Expected Areas of Change
`server/mail/index.js` and `server/mail/templates.js` (new), `server/config.js`, `server/routes/admin.js`, `server/package.json`, a new `web/src/components/admin/EmailPage.jsx`, `ProfileDialog.jsx` (the page list), `web/src/api.js`, README, tests (`server/tests/mail.test.js`, `EmailPage.test.jsx`).

## Not in scope
Any email besides the test (P12-02 … P12-04). A persistent queue. Provider HTTP APIs.
