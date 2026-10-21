# P11-08 — Sign-in hardening

- **Unit Type:** Implementation (child of P11-00)
- **Phase:** 11
- **State:** READY (build order 4 in P11-00; start only when the owner says so)
- **Effort:** S–M
- **Depends on:** none. Behind the tunnel, the last X-Forwarded-For hop is Cloudflare's view of the visitor, so the per-IP part works today. P11-05 makes it airtight.
- **Serialize with:** P11-03 if it changes `auth/rateLimit.js`. Whichever goes second rebases.
- **Requirement Source:** P11-00 finding M3.

## Problem
- `/login` is limited per IP only, 15 per 15 minutes (`server/routes/auth.js:120`). Many addresses, or one IPv6 /64, can guess one account's password without limit.
- Passwords need only 8 characters (`server/validate.js:45`).
- The limiter map only drops expired buckets (`server/auth/rateLimit.js:15-17`), so a flood of new keys grows it.

## Scope
- **Why it's early in the order:** with registration closed, sign-in is the one thing a stranger on the internet can reach. SWAG's fail2ban is no longer in the path. Until this lands, the Cloudflare rate-limit rule in P11-00 ("Cloudflare settings to do now") is the stopgap.
- **IPv6 is common through Cloudflare:** `CF-Connecting-IP` is often an IPv6 address, so the /64 keying below matters.
- **Per account:** count failed logins per username (lower-cased), whatever the IP. After 10 failures in 15 minutes, refuse that username for 15 minutes with the same 429 text as today; a success resets the count. Unknown usernames are counted too, so the answer never reveals whether the account exists.
- **IPv6:** key rate limits by the /64.
- **Bounded limiter:** cap the map at, say, 50,000 keys. When full, evict the oldest; never grow past the cap.
- **Common passwords:** at sign-up and password change, refuse the top ~1,000 common passwords (a small file in the repo, lower-cased) and passwords equal to the username. The message: "That password is too easy to guess".
- **Log** repeated failures (`[auth] 10 failed sign-ins for <name> from <ip>`), so the owner can see an attack in the container log.

## Acceptance criteria
- [ ] AC-1: 11 wrong passwords for `sandy`, from 11 different (trusted-proxy) IPs, then the right one → 429. After the window, the right one → 200.
- [ ] AC-2: unknown usernames behave the same (429 after 10).
- [ ] AC-3: two IPv6 addresses in one /64 share a bucket.
- [ ] AC-4: inserting 100,000 distinct keys leaves the map at or under the cap.
- [ ] AC-5: `password123` is refused at sign-up and on change; a long random one is accepted. The existing test users' passwords are updated where they collide.
- [ ] AC-6: both suites pass.

## Expected Areas of Change
`server/auth/rateLimit.js`, `server/routes/auth.js`, `server/validate.js`, `server/auth/common-passwords.txt` (new), tests (`server/tests/login-limits.test.js` new, and any test using a refused password), the web sign-up and change-password forms (show the server's message; check that they already do).

## Not in scope
TOTP or passkeys (P11-00 Discovered Work). CAPTCHA.
