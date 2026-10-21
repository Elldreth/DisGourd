# P12-00 — Email: password reset and security notices

- **Unit Type:** Container (children P12-01 … P12-04)
- **Phase:** 12
- **State:** PLANNED
- **Effort:** L in total
- **Depends on:** P11-01 (setup code) and P11-12 (case-insensitive usernames and emails). Soft: P11-08 (sign-in hardening; its limiter is reused here) and P11-14 (secrets from the environment).
- **Requirement Source:** the owner's email conversation (2026-10-21), after moving the server to Unraid behind a Cloudflare Tunnel.

## Owner decisions (2026-10-21)
1. **Provider: Resend**, sending over SMTP on port 587. The free plan covers 3,000 emails a month at 100 a day. The app only knows SMTP, so the provider can change later without code changes.
2. **First emails: password reset and security notices.** Email invites and a missed-mention digest are not planned yet.
3. **Verification is optional, and an admin can require it.** People confirm an address by clicking a link. Password reset only goes to a confirmed address.
4. **An email address is optional.** Anyone can add one in Settings. Without one, a site admin can still make a reset link for them.

## Where things stand today
- `users.email` is `UNIQUE NOT NULL` (`server/db/migrations.js:44`) and required by `/register` (`server/validate.js:48`). It is never checked, and case-sensitive until P11-12.
- `/me` returns the address, and Settings › My account shows it (`web/src/components/ProfileDialog.jsx:152`). It can't be changed.
- There is no way to recover a forgotten password. A site admin can only remove the account.
- Changing a password signs out every other device (`server/routes/auth.js:151`, P9-03). Sessions are listed per device (`sessions` table, migration v27).

## Shape
| Unit | What | Effort | Depends on |
|---|---|---|---|
| P12-01 | Sending email: SMTP from the environment, a mailer with a queue and a daily cap, the Site admin › Email page with "Send test email", Resend and Cloudflare DNS docs | S–M | P11-14 (soft) |
| P12-02 | Email addresses: optional, confirm with a link, change it with your password, the admin "require confirmed email" switch | M | P12-01, P11-12 |
| P12-03 | Password reset: "Forgot password?", a one-time link, and an admin-made reset link | M | P12-02, P11-08 (soft) |
| P12-04 | Security notices: password changed, email changed, new device signed in | S | P12-02 |

Build order: P12-01 → P12-02 → P12-03 → P12-04. P12-03 and P12-04 could run in parallel once P12-02 lands; they touch different routes.

## Rules for every child
- **Secrets stay in the environment:** `SMTP_PASS` or `SMTP_PASS_FILE`, never `site_settings` (P11-00 "Secrets", P11-14). The admin page shows only whether email is set up and which address it sends from.
- **No account enumeration:** "Forgot password?" and "Resend confirmation" answer the same way whether or not the address exists.
- **Tokens:**
  - They are random (32 bytes) and stored only as a SHA-256 hash.
  - Each is single-use and short-lived: 30 minutes for a reset, 24 hours for a confirmation or an admin reset link.
  - Each is bound to the user and the purpose, and compared in constant time.
  - Links carry the token in the URL fragment (`/#reset=…`), so it isn't sent in request lines or logged by proxies. The app posts it in the request body.
- **Links use `PUBLIC_URL`** (for example `https://disgourd.2108464.xyz`), never the request's Host header. Without `PUBLIC_URL`, email is off.
- **Plain text plus simple HTML:**
  - Every email has both, in the app's voice, with no remote images or tracking.
  - Each says which server sent it and "If this wasn't you, …".
- **Sending never blocks a request.** Mail goes into an in-memory queue with retries. A failure is logged and shown on the admin page, never to the person who asked for it.
- **Both test suites, the sandbox, and `web/devProxy.js`** for every new top-level route, as always.

## Migration
P12-02 adds one migration. Its number is the next free one at build time, because P11-04, P11-09 and P11-12 also add migrations.

`users.email` must drop `NOT NULL`. SQLite can't alter a column constraint, so it's a table rebuild: `foreign_keys=OFF`, create `users_new`, copy, drop, rename, recreate indexes, `foreign_key_check`, then `foreign_keys=ON`. The migration runner may need a "no transaction" option for this. Test it on a copy of a real-sized database.

## Not in scope (recorded)
- Email invites, a missed-mention digest, replying by email, and receiving mail in the app.
- Two-factor sign-in.
- Sending via the Resend HTTP API, or any provider-specific API.
- Marketing or bulk mail.

## Discovered Work
- **Domain reputation:** number-only `.xyz` domains get extra suspicion from some spam filters. SPF, DKIM and DMARC through Resend should be enough. If inbox placement is poor, a cheap separate sending domain is the fallback (an owner decision, not code).
- **Receiving replies:** Cloudflare Email Routing (free) can forward `admin@2108464.xyz` to the owner's mailbox. That's a docs note in P12-01, not app code.
