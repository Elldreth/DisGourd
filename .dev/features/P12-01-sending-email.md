# P12-01 — Sending email: SMTP settings, mailer, "Send test email"

- **Unit Type:** Implementation (child of P12-00)
- **Phase:** 12
- **State:** COMPLETE (merged in #233; AC-8 checked live on 2026-10-21)
- **Starting baseline:** main after #232
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
  | `MAIL_FROM` | `DisGourd <no-reply@example.com>` | Required. Must be on a domain verified with the provider |
  | `MAIL_REPLY_TO` | `admin@example.com` | Optional |
  | `PUBLIC_URL` | `https://disgourd.example.com` | Required for links. Email is off without it |

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

## As built
- **`server/mail/index.js`:**
  - **Settings** are read from the environment on each use, so `SMTP_PASS_FILE` goes through the P11-14 `secretFromEnv` helper; an unreadable file shows as missing, naming the variable only.
  - **`status()`** is everything the admin page shows, with no password in it.
  - **The transport is nodemailer 10.0.15,** pinned exactly (the newest release at least two weeks old; `npm audit` is clean). On 587/2587 it uses `requireTLS: true`; 465/2465 use `secure`. Timeouts: connect 15 s, greeting 15 s, socket 30 s.
  - **Every message** gets a `Message-ID` on the From domain, a `Date` and `Auto-Submitted: auto-generated`.
  - **The queue:** in memory, one send at a time. Retries after 1 min, then 5 min (`MAIL_RETRY_MS` overrides this for tests), so 3 attempts in all.
  - **Limits:** a daily cap (`MAIL_DAILY_LIMIT`, default 90, counted per UTC day) and 5 per recipient per hour, compared case-insensitively.
  - **Errors** go through `redact()`, which removes the password and its SMTP AUTH base64 forms and caps the text at 300 characters.
  - **Log lines** name only the recipient's domain (`…@example.com`).
- **`server/mail/templates.js`:** `layout()`, with the server name, a heading, paragraphs, one button with its link written out, and a footer. Everything is escaped, the CSS is inline, and there are no images. `testEmail()` is the only email so far. `MAIL_SERVER_NAME` names the server (default "DisGourd").
- **Routes** (`server/routes/admin.js`, site admins only; `/admin` is already in devProxy):
  - `GET /admin/email` returns the status plus `yourAddress`.
  - `POST /admin/email/test { to? }`:
    - Answers 202 `{ queued, to }`.
    - Answers 409 when email is off, naming the missing variables, and 400 for a bad address.
    - Answers 429 for 5 tests an hour per admin, the daily cap, or the per-recipient limit.
- **Web:** Settings › Site admin › **Email** (`EmailAdmin.jsx`), after People:
  - **The status:** a dot, "Email is set up" with the From, server and port, STARTTLS or TLS, and the link base; or "Email is off" with the missing variables as chips.
  - **Today:** Sent, Failed, Over the limit and Daily limit, plus the last error and its time.
  - **Send a test email:** an empty box sends to your own address. The answer says "Queued for …", because sending happens in the background.
- **README:**
  - a new **Email** section: Resend steps, the DNS records in Cloudflare (DNS only), a sending-only API key in a secret file, the compose lines, ports 2587 and 465, Email Routing for replies, and the limits;
  - rows in the configuration table;
  - the secrets table entry.

## Acceptance criteria
- [x] AC-1: with no SMTP variables, `mail.enabled()` is false, the admin page says "Email is off" and names the missing variables, and nothing tries to send.
- [x] AC-2: with a fake SMTP server (nodemailer's stream transport, or a local test server in Jest), "Send test email" delivers one message with both text and HTML parts, the right From, and a link built from `PUBLIC_URL`.
- [x] AC-3: the password never appears in any response, log line or error shown on the admin page (a test greps the captured output).
- [x] AC-4: a failed send is retried up to 3 times and then recorded as failed. The request that queued it got its answer immediately.
- [x] AC-5: the daily cap and the per-recipient limit hold, and the admin page shows the counts.
- [x] AC-6: non-admins get 403 from both routes.
- [x] AC-7: port 587 refuses to send without STARTTLS (`requireTLS`).
- [x] AC-8: live check in the sandbox with the owner's Resend key: a test email arrives in the owner's inbox. Note whether it landed in spam, and check SPF/DKIM/DMARC "pass" in the message headers.

## Expected Areas of Change
`server/mail/index.js` and `server/mail/templates.js` (new), `server/config.js`, `server/routes/admin.js`, `server/package.json`, a new `web/src/components/admin/EmailPage.jsx`, `ProfileDialog.jsx` (the page list), `web/src/api.js`, README, tests (`server/tests/mail.test.js`, `EmailPage.test.jsx`).

## Not in scope
Any email besides the test (P12-02 … P12-04). A persistent queue. Provider HTTP APIs.

## Evidence (2026-10-21)
| Criterion | Evidence |
|---|---|
| AC-1 | `mail.test.js` "with nothing set": `enabled()` false, `GET /admin/email` gives missing `[SMTP_HOST, MAIL_FROM, PUBLIC_URL]`, the test send gives 409 with the names, `send()` gives `{ queued: false, reason: 'off' }`, and nothing is sent. A user without a password gives "SMTP_PASS or SMTP_PASS_FILE". `EmailAdmin.test.jsx`: "Email is off", the missing chips, the button disabled |
| AC-2 | "Send test email": 202 `{ queued, to: 'owner@example.com' }` (your own address). The message has the From, Reply-To, `Auto-Submitted`, a `Message-ID` on example.com, both text and HTML, and a link to PUBLIC_URL (trailing slash trimmed). A typed address works; a bad one gives 400 |
| AC-3 | The fake transport throws errors that contain the password: `lastError` reads `[redacted]`, and neither the status JSON nor any captured `console.*` line contains the password. Logs show `…@example.net`, never the full address |
| AC-4 | 2 failures then a success: sent 1. 3 failures: failed 1, with lastError. The request answered 202 in under 1 s |
| AC-5 | `MAIL_DAILY_LIMIT=7`: 5 to one address, then the 6th (different case) is refused as `recipient`; 2 more fill the cap; the next is refused as `cap`. Counts: sent 7, overCap 1, overRecipient 1. The test route then gives 429 "Today's limit of 7 emails is reached." |
| AC-6 | "site admins only": 401 without a token, 403 for a member, on both routes |
| AC-7 | Port 587 gives transport options `{ secure: false, requireTLS: true }`, with the password read from `SMTP_PASS_FILE`; 465 gives `{ secure: true }` |
| Templates | Values are escaped in the HTML (name, link `&amp;`, quotes); no `<img>` or `<script>`; the text version is plain |
| Suites | Server 634 tests (2 skipped are the Linux-only backup tests), web 865 tests; `vite build` clean. `SiteAdminPages.test.jsx` tab order now includes Email |
| Sandbox | A throwaway copy of the sandbox DB on :3011, with SMTP pointed at a closed port (127.0.0.1:2599). Settings › Site admin › Email showed "Email is set up", the From, `127.0.0.1:2599 (STARTTLS)` and the link base. Send test email → "Queued for sandy@example.test…" → 3 attempts (logged with `…@example.test` only, no password) → Failed 1, and "Last error … connect ECONNREFUSED 127.0.0.1:2599". This walk led to changing the result wording from "Sent to" to "Queued for". The temporary entry and DB were removed |
| AC-8 | **Live, on the owner's Unraid server (2026-10-21).**<br>• Setup: Resend with a sending subdomain (`mail.<domain>`), its records in Cloudflare DNS only, a sending-only key as a secret file (`SMTP_PASS_FILE`), and port 587.<br>• **First test:** arrived in the Gmail **Inbox**, with `dkim=pass` (`header.i=@mail.<domain>`, selector `resend`) and `spf=pass`. TLS 1.3 to Gmail. Text and HTML parts, `Auto-Submitted`, Reply-To and the link as built. Resend replaced the `Message-ID` with its own (harmless).<br>• **DMARC:** there was no record at first, so no result. After `_dmarc` (`p=none`) was added, the next test reported **DMARC pass** |
