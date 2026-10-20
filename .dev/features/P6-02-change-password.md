# P6-02 — Change password

- **Unit Type:** Implementation
- **Phase:** 6
- **State:** REVIEW (details confirmed by the owner, 2026-10-20)
- **Effort:** M (migration v25)
- **Depends on:** none
- **Serialize with:** none of P6 (it touches `routes/auth.js`, `auth/tokens.js` and `ProfileDialog.jsx`, which P6-01 and P6-03 don't)
- **Requirement Source:** `design/settings-review-2026-10/REVIEW.md` discovered work ("change password").

## Scope
- **Server:** `POST /me/password {currentPassword, newPassword}`. You must be signed in.
  - The current password is checked with `verifyPassword`; a wrong one gets 403.
  - The new one follows the registration rules: 8 to 200 characters. It also can't equal the current one.
  - It's hashed with async scrypt (`generateSalt` plus `hashPassword`) and saved with `db.changePassword`, which also bumps the token version.
  - It's rate limited per user, at 10 tries per 15 minutes (`rateLimitOk`), so a stolen token can't be used to guess the password.
- **Other sessions (confirmed by the owner, 2026-10-20).** Today tokens are stateless 7-day JWTs with no way to revoke them. The plan:
  - Migration **v25** adds `users.token_version INTEGER NOT NULL DEFAULT 0`.
  - Tokens carry `ver`; a token without one counts as 0, so nobody is signed out by the upgrade.
  - `authUserId` and the gateway connect refuse a token whose `ver` doesn't match. That's one primary-key lookup per request.
  - Changing the password bumps the version, returns a fresh token for this device (the client stores it), and closes the user's other gateway sockets. Those clients then land on the sign-in screen.
  - Without this, a changed password leaves a stolen token working for up to 7 days.
- **Client:** in Settings › My account, a "Password" card under Status with a "Change password" button. It opens a small kit-style dialog (`Modal` like `BanDialog`):
  - fields: current password, new password, confirm new password; Cancel / "Change password"
  - inline errors for "doesn't match", "too short" and the server's message
  - on success it closes and shows a short note: "Password changed. Other devices were signed out."

## Acceptance criteria
- [x] AC-1: with the correct current password and a valid new one, the route returns 200. Signing in works with the new password and fails with the old one.
- [x] AC-2: a wrong current password gets 403 and changes nothing. A new password that's too short or too long, or the same as the current one, gets 400. Without a token the route returns 401. The 11th try within 15 minutes gets 429.
- [x] AC-3: after a change, an older token gets 401 on HTTP and is refused on the gateway, and the user's other open sockets are closed. The returned token works. Tokens issued before v25 (no `ver`) still work until a change.
- [x] AC-4: the dialog checks that the two new passwords match and are at least 8 characters before sending. It shows server errors inline, and on success it stores the returned token and closes.
- [x] AC-5: the server tests are in `server/tests/change-password.test.js` (and the migration test covers v25). A web test covers AC-4. The existing suites stay green.
- [x] AC-6: a sandbox check: cara changes her password in one tab, a second tab signed in as cara is signed out, and the new password signs in. Screenshots. The sandbox password is put back afterwards.

## Expected Areas of Change
`server/routes/auth.js`, `server/auth/tokens.js`, `server/db/migrations.js` + `server/db/index.js` (v25 and the version getter/bump), `server/gateway/index.js` (version check on connect, close other sockets), `web/src/api.js`, `web/src/components/ProfileDialog.jsx`, a new `web/src/components/ChangePasswordDialog.jsx`, plus tests.

## Working Set / Blast Radius
About 8 files. The token check runs on every authenticated request, so a mistake signs everyone out. The tests cover old tokens explicitly.

## Testing Strategy
Jest for the route, the token versions and gateway refusal; Vitest for the dialog; sandbox with two tabs.

## Out of Scope
A "forgot password" email flow, a site admin resetting someone else's password, a list of active sessions.

## Starting Baseline
Revision: `d7f159a` (main after #165). Latest migration v24; this adds v25.

## Implementation notes
- `createToken` stamps `ver` from `users.token_version`. `verifyToken` (used by `authUserId` and by the gateway on connect) refuses a token whose version doesn't match, or whose user no longer exists. `tokens.js` loads the database lazily, because tests require it before `DB_PATH` is set.
- `endStaleSessions` (`gateway/delivery.js`) sends `{type:'signed_out', reason:'password_changed'}` to each of the user's sockets with an older version, then closes them with code 4001. Each socket remembers the version it connected with.
- **Client:**
  - `api.changePassword` stores the returned token as soon as it arrives.
  - On `signed_out`, the app calls `api.stillSignedIn()`. It first waits for a change in flight, so the device making the change isn't signed out by its own change, then checks `/me`.
  - On the device that changed the password, `/me` passes and the app carries on with the new token; the gateway reconnects with it. Anywhere else the check gets 401, the token is cleared, and the app goes back to sign-in.

## Verification Evidence
| Acceptance Criterion | Status | Verification Type | Evidence |
|---|---|---|---|
| AC-1 | Verified | Jest `change-password.test.js` + sandbox | 200 with a fresh token. Sign-in works with the new password and gets 401 with the old one, both in Jest and in the sandbox. |
| AC-2 | Verified | Jest | 401 without a token. 403 for a wrong current password. 400 for too short, too long, not a string, or unchanged. The old password still works after each refusal. The 11th try gets 429 (rate limits switched on for that test). |
| AC-3 | Verified | Jest + sandbox | After a change, three older tokens get 401: this device's, another login's, and a pre-v25 one. Both open sockets got `signed_out` and closed with code 4001. An old token can't reconnect; the new one can. A second change stops the first new token. A pre-v25 token works until a change: in Jest, and in the sandbox, where the tab signed in before the upgrade stayed signed in after the restart. |
| AC-4 | Verified | Vitest `ChangePassword.test.jsx`, `passwordToken.test.js` + sandbox | The dialog refuses too short, not matching and unchanged before sending, shows the server's message inline (`design/p6-actions/shots/p6-02-wrong-current.jpg`), and on success hands back the token, closes and shows the note (`p6-02-changed.jpg`). `api.changePassword` stores the token; `stillSignedIn` waits for a change in flight. |
| AC-5 | Verified | Jest, Vitest, Vite | Server 43 suites / 407 tests. The migration test now reaches v25. Web 91 files / 731 tests, all green. `vite build` clean. |
| AC-6 | Verified | Sandbox (a copy of the sandbox DB on :3007, this branch's code, migrated to v25) | cara in two tabs, localhost and 127.0.0.1 (`p6-02-my-account.jpg`). After the change, the changing tab stayed signed in with a version-1 token: `/me` 200, and the server log shows its socket reconnected. The other tab went to the sign-in screen (`p6-02-other-tab-signed-out.jpg`). Then the password was put back to the sandbox one, and sign-in with it works. |
