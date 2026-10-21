# P11-08 — Sign-in hardening

- **Unit Type:** Implementation (child of P11-00)
- **Phase:** 11
- **State:** REVIEW (build order 5 in P11-00)
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
- [x] AC-1: 11 wrong passwords for `sandy`, from 11 different (trusted-proxy) IPs, then the right one → 429. After the window, the right one → 200.
- [x] AC-2: unknown usernames behave the same (429 after 10).
- [x] AC-3: two IPv6 addresses in one /64 share a bucket.
- [x] AC-4: inserting 100,000 distinct keys leaves the map at or under the cap.
- [x] AC-5: `password123` is refused at sign-up and on change; a long random one is accepted. The existing test users' passwords are updated where they collide.
- [x] AC-6: both suites pass.

## As built
- **`server/auth/rateLimit.js`:**
  - **Per account:** `accountLocked` / `accountFailed` / `accountSucceeded` count failed sign-ins per lower-cased username, from any address, whether or not the account exists. After 10 in 15 minutes, `/login` answers the same 429 as the per-address limit. A success clears the count.
  - **IPv6:** `addressKey()` keys IPv6 by its /64 (and `::ffff:a.b.c.d` as plain IPv4). `limitKey(req)` is what `/login` and `/register` use now.
  - **Bounded map:** the limiter map is capped at 50,000 keys. Expired windows go first, then the oldest. Before, it only swept expired windows, so it could grow without bound.
- **`/login`:** after the 10th failure for a name it logs `[auth] 10 failed sign-ins for <name> (latest from <address>); it's locked for 15 minutes` (the name is sanitised).
- **`server/auth/commonPasswords.js`** (new): `passwordProblem(password, username)` returns "That password is too easy to guess" for:
  - About 150 well-known 8+ character passwords from public breach lists.
  - A common word padded with digits or a "!" (`password2024`, `qwerty99!`, `disgourd7`).
  - One character repeated, or a run (`12345678`, `abcdefgh`, `98765432`).
  - A password that contains the username.

  It's used by `validateRegistration` (sign-up) and `/me/password`.
- **Web:** no change. The sign-up form and the change-password dialog already show the server's message (checked in the sandbox).
- **Docker smoke test:** it used `smoke-pass-123` for user `smoke`. The username rule refused that, and the CI Docker job failed at its `register` step (run 39553258055). It now uses `amber-lantern-orbit-58`, which the checker accepts for both `smoke` and `nocode`. `.dev/security/p11-00-proof.js` moved off `password123` too, and now shows the fixed behaviour (setup code required, legacy route 404, 0 junk read rows).
- **Tests:** 49 server test files used `password123` (and one `password456`). They now use `gourd-test-pass-1` / `-2`. In `api.test.js`, the 0.4 per-address test uses a new name per attempt, so the new per-account lock doesn't trip it.

**Deviation from the scope:** the scope asked for the top ~1,000 common passwords as a file. Fetching such a list means downloading from outside, which wasn't approved. So the list is curated by hand (8+ characters only, since shorter ones are already refused) and backed by the pattern checks. A bigger list can be dropped into `COMMON` later.

**Cloudflare (the owner's settings, 2026-10-21):** the live server also has a Cloudflare rate-limiting rule, "Sign-in limit": `POST` to `/login` or `/register`, 5 requests per 10 s per IP, then a 10 s block. It sits in front of these limits and complements them: Cloudflare cuts bursts at the edge, and the app enforces per-account and per-/64 limits that Cloudflare can't see.

## Verification Evidence
| Acceptance Criterion | Status | Verification Type | Evidence |
|---|---|---|---|
| AC-1 | Verified | Jest `sign-in-limits.test.js` + sandbox | 10 wrong from 10 addresses, then the right password → 429, with the log line. After the window → 200. 9 failures still allow the right password, and a success resets the count. Mixed case counts as one name. Sandbox: 10 wrong for `Cara` → the right password → 429 "Too many attempts…", and the log said `[auth] 10 failed sign-ins for Cara…`. A sandbox restart cleared it (cara → 200) |
| AC-2 | Verified | Jest | `nobody-here`: 10 × 401, then 429 |
| AC-3 | Verified | Jest | `addressKey` puts `2001:db8:1:2:aaaa::1` and `…:ffff:ffff:ffff:ffff` together, and keeps another /64 apart. 15 failures from one /64 → 429; another /64 → 401 |
| AC-4 | Verified | Jest + timing | 100,000 keys → size ≤ 50,000, in under 1.5 s (32 ms measured). The first version trimmed one key at a time once full, which was quadratic: 8.4 s for 100,000 keys. That stalled the event loop past the 5 s keep-alive timeout and reset a kept-alive socket in CI (run 39552647540, `fetch failed / ECONNRESET`). A trim now goes down to 45,000, so the full pass runs once per 5,000 new keys |
| AC-5 | Verified | Jest + sandbox + app | 9 easy passwords refused at sign-up (including `password123`, `Password1`, `aaaaaaaa`, `disgourd2024`, `walrus-walrus` for user walrus); a long random one accepted; a change to `letmein123` refused. Sandbox: sign-up with `password123` → 400; cara changing to `letmein123` → 400. App: the Change password dialog shows "That password is too easy to guess". Test passwords were updated across 49 files |
| AC-6 | Verified | Jest, Vitest | Server 58 suites / 529 tests; web 107 files / 844 tests |

## Discovered Work (not done here)
- **The lockout trade-off:** anyone who knows a username can lock it out for 15 minutes with 10 wrong passwords. That's the price of stopping distributed guessing. If it becomes a nuisance, a progressive delay, or a per-account limit that skips an address with a recent successful sign-in, would soften it.
- **Locks are in memory:** a restart clears them, which is fine for one process.

## Expected Areas of Change
`server/auth/rateLimit.js`, `server/routes/auth.js`, `server/validate.js`, `server/auth/common-passwords.txt` (new), tests (`server/tests/login-limits.test.js` new, and any test using a refused password), the web sign-up and change-password forms (show the server's message; check that they already do).

## Not in scope
TOTP or passkeys (P11-00 Discovered Work). CAPTCHA.
