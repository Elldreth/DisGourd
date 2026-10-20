# P9-03 — Signed-in devices

- **Unit Type:** Implementation
- **Phase:** 9
- **State:** READY
- **Effort:** M (migration v27)
- **Depends on:** P6-02 (change password; token versions)
- **Requirement Source:** the follow-up list (2026-10-20). Design agreed with the owner on 2026-10-20:
  - **What each device shows:** browser, system and times, e.g. "Chrome on Windows · signed in Oct 18 · active 5 minutes ago", with "This device" on yours. **No IP addresses are stored.**
  - **Actions:** "Sign out" on each other device, plus "Sign out all other devices". Both take effect at once.
  - **Where:** Settings › My account, under Change password, as "Signed-in devices".

## Today (main at #180)
- **Tokens:** sign-in tokens are stateless JWTs (`server/auth/tokens.js`) with `sub`, `name`, `ver` (P6-02), `iat` and `exp` (7 days). Nothing records which devices hold them.
- **Where they're made:** register, sign in and change password (`routes/auth.js`). There's no refresh, so a token simply expires after 7 days.
- **Changing the password** bumps `users.token_version`, which signs out every other token, and returns a fresh one.

## Scope
- **Migration v27:** `sessions(id TEXT PRIMARY KEY (random 16 bytes, base64url), user_id → users ON DELETE CASCADE, device TEXT, created_at, last_seen_at)`.
  - `device` is a short label worked out from the User-Agent at sign-in ("Chrome on Windows", "Safari on iPhone", "Firefox on Linux", "DisGourd app on Android" for the installed PWA where it can be told, else "Unknown device"). The raw User-Agent isn't kept.
- **Tokens:** a new token carries `sid`.
  - `verifyToken` refuses a token whose `sid` no longer exists, or belongs to someone else.
  - `last_seen_at` updates at most once every 5 minutes per session.
  - **Tokens from before this change** (no `sid`) keep working until they expire, at most 7 days. They can't be listed, so the list says "Sign-ins from before this update aren't listed; they end within a week, or now with Sign out all other devices".
- **Routes:**
  - **`GET /me/sessions`:** `[{ id, device, createdAt, lastSeenAt, current }]`, newest activity first. Sessions past the 7-day token life are pruned.
  - **`DELETE /me/sessions/:id`:** sign out that device (not your current one; 400). Its open sockets are closed with `signed_out`.
  - **`POST /me/sessions/sign-out-others`:** deletes every other session and bumps the token version, which also ends the older sid-less tokens. Returns a fresh token for this device, keeping its session.
  - **`POST /logout`:** the app's Log out deletes the current session. Log out today only forgets the token in the browser.
  - **Change password (P6-02)** now also deletes the other sessions and keeps this one.
- **Gateway:** a socket remembers its `sid`, so signing out a device closes that device's sockets. The app then drops to the sign-in page with "You were signed out on this device."
- **App:**
  - **Settings › My account › "Signed-in devices":** each row shows an icon (desktop / phone), the label, "Signed in Oct 18 · Active 5 minutes ago" (or "Active now"), and "This device" or a Sign out button.
  - **"Sign out all other devices"** asks first.
  - The note about older sign-ins sits under the list.

## Acceptance criteria
- [ ] Server: sign-in, register and change password create sessions with a device label; the list (current marked, pruned); sign out one (not current; 404 for another user's id); sign out all others (the fresh token works, the old ones from other sessions and sid-less tokens stop); last-seen throttling; logout ends the session; sockets of a signed-out session are closed.
- [ ] Web: the section, rows, "This device", Sign out (confirm-free) and Sign out all others (with confirm, stores the fresh token), the note; the signed-out screen message.
- [ ] All suites pass; `vite build` is clean.
- [ ] Sandbox: sandy signs in in two tabs; tab A lists both, signs out tab B; tab B drops to sign-in with the message; "Sign out all others" works and tab A stays signed in.
