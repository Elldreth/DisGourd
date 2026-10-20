# P9-03 — Signed-in devices

- **Unit Type:** Implementation
- **Phase:** 9
- **State:** COMPLETE (merged #182)
- **Starting baseline:** main at d9bb846 (#181 merged)
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

## As built
- **Server code:**
  - `server/auth/device.js` makes the labels: Edge, Opera, Samsung Internet, Firefox, Chrome or Safari, on iPhone, iPad, Android, ChromeOS, Windows, macOS or Linux. The installed app isn't told apart from its browser.
  - `authPayload` gives routes the token's `sid`.
  - `endOtherSessions(user, keep, bump)` deletes the other sessions. It moves the token version on, except for a password change, which already did.
  - `endSession` closes one device's sockets with `signed_out { reason: 'device' }`. "Sign out all others" uses reason `signed_out_elsewhere`.
- **Added while testing:**
  - **Live list:** the open list didn't notice new sign-ins. Now every sign-in, sign-out and logout sends the user's open windows `sessions_changed`, and the list reloads.
  - **Bug found and fixed:** "Sign out all other devices" signed out *this* device too. That `sessions_changed` frame made this tab reload its list with the old token a moment before the fresh token arrived; the 401 looked like "signed out", and the app dropped to sign-in. Now a request refused with an old token while a swap is in flight (this, or a password change) waits for the new token and retries once. A 401 with no swap still signs out, once.
- **App:**
  - "This device" is a green badge, and its row reads "Active now".
  - The dev proxy now includes `/logout`.

## Acceptance criteria
- [x] Server: sign-in, register and change password create sessions with a device label; the list (current marked, pruned); sign out one (not current; 404 for another user's id); sign out all others (the fresh token works, the old ones from other sessions and sid-less tokens stop); last-seen throttling; logout ends the session; sockets of a signed-out session are closed.
- [x] Web: the section, rows, "This device", Sign out (confirm-free) and Sign out all others (with confirm, stores the fresh token), the note; the signed-out screen message.
- [x] All suites pass; `vite build` is clean.
- [x] Sandbox: sandy signs in in two tabs; tab A lists both, signs out tab B; tab B drops to sign-in with the message; "Sign out all others" works and tab A stays signed in.

## Evidence (2026-10-20)
| Acceptance criterion | Evidence |
|---|---|
| Server | `sessions.test.js` (8):<br>• **Labels:** Chrome on Windows, Safari on iPhone, Firefox on Linux, Edge on Windows, Unknown device.<br>• **The list:** two sign-ins → both listed, the current one marked, and no User-Agent or IP in the response.<br>• **Sign out one:** your own → 400, an unknown id → 404, then the laptop → 200; its socket gets `signed_out { reason: 'device' }` and closes with 4001, its token fails and the phone's still works. Another account → 404.<br>• **Sign out all others:** the fresh token works; the other device's, the registration's and an older sid-less token all fail; the other socket gets `signed_out_elsewhere`; one device remains.<br>• **Log out** ends the session; without a token it's a no-op 200.<br>• **Last seen:** not touched within a minute, touched after ten.<br>• **Password change:** keeps this device only.<br>• **Live list:** a new sign-in and a logout each send `sessions_changed` to open sockets.<br>`change-password.test.js` still passes (one version bump). Server suites: 50 files, 441 |
| Web | `Devices.test.jsx` (7): rows with label, signed-in day and "Active 3 h ago"; This device has no button; Sign out → `signOutSession('b')` and a reload; Sign out all others asks first, then `onToken('fresh-token')`; the button is disabled with no others unless older sign-ins may exist; "Active now"; the sign-in page's note; the list reloads on `disgourd:sessions-changed` and stops listening when closed. `passwordToken.test.js` (+2): a request refused with the old token during a swap retries with the new one and doesn't sign out; a 401 with no swap signs out once. Web suites: 102 files, 794; `vite build` clean |
| Sandbox (:3005, restarted on this branch; sandy signed in on two tabs) | Settings › My account › Signed-in devices listed both "Chrome on Windows" rows, one marked This device. Sign out on the other → that tab dropped to sign-in with "You were signed out of this device from another one." A sign-in from a "Firefox on Linux" User-Agent appeared in the open list by itself. The first try of Sign out all other devices also signed out this tab (the race above); after the fix: this tab stayed signed in ("Your other devices were signed out.", one device left), and the other tab showed "You were signed out: all other devices were signed out from another one." Log out → the old token gets 401 |
