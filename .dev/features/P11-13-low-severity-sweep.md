# P11-13 — Low-severity sweep

- **Unit Type:** Implementation (child of P11-00)
- **Phase:** 11
- **State:** REVIEW (build order 14, the last in Phase 11)
- **Starting baseline:** main at 33c555f (#229 merged)
- **Effort:** S–M
- **Depends on:** P11-01 … P11-12 merged (or at least P11-03, P11-07, P11-12)
- **Serialize with:** everything in P11. This goes last.
- **Requirement Source:** P11-00 findings L1–L7 and L9. L8 and L10 are in P11-05.

## Scope
- **L1, fixed error texts:** `/register` and `/login` catch blocks (`server/routes/auth.js:112,144`) return a fixed "Something went wrong" (400 for a bad body, 500 otherwise) and log the error. They no longer echo `e.message`.
- **L2, backups:**
  - `runBackup` chmods each copy to 0600 (`server/backup.js:48`).
  - The README gets "Off-site backups" (a restic or rclone example to object storage, encrypted). It says the copies hold password hashes, DMs and any kie.ai key saved in the app, and recommends `KIEAI_API_KEY` in the environment on the cloud host.
- **L3, moderators and private channels:**
  - Report lists and the moderation log hide entries from channels the moderator can't view (`server/routes/spaces.js:247`, `:151-161`). Counts follow.
  - `DELETE /spaces/:s/channels/:c` (`:654-658`) requires `canViewChannel` too.
- **L4, tokens:**
  - Tokens without `sid` are refused (`server/auth/tokens.js:44-49`). They've all expired by now (7 days after P9-03), so this is clean-up.
  - The heartbeat re-verifies each socket's token every 30 minutes and closes expired ones (4001).
- **L5, the Origin check:** in P11-07; tick it here if it landed there.
- **L6, one sign-up message:** `/register` answers 409 "That username or email can't be used" for both cases (`server/routes/auth.js:89-91`, and the race path at `:105`).
- **L7, invite expiry:** new invites expire after 7 days by default. `POST /spaces/:s/invites { expiresInDays?: 1|7|30|null, maxUses? }`, with `null` meaning never. The invite dialog gets an "Expires after" select.
- **L9, dev dependencies:** `npm audit fix` in server/ (the Jest chain) and bump Vite past 8.3.2 in web/. Rerun both audits, and both suites plus `vite build`.

## Acceptance criteria
- [x] AC-1: a forced throw in `/register` answers without its message text.
- [~] AC-2: a new backup file is mode 0600 (skipped on Windows).
- [x] AC-3: a moderator who can't view #secret sees no reports or log excerpts from it, and can't delete it.
- [x] AC-4: a hand-made token without `sid` → 401. A socket whose token expires is closed within a heartbeat-check period (the test uses a short interval).
- [x] AC-5: a duplicate username and a duplicate email get the same 409 text.
- [x] AC-6: a default invite has an expiry; "never" still works.
- [x] AC-7: `npm audit` reports 0 high in both packages (or the remaining ones are listed with a reason). Both suites and `vite build` pass.

## As built
- **L1** (`routes/auth.js`): `/register` and `/login` errors go through `failed()`.
  - Our own 4xx refusals keep their fixed words ("Invalid JSON", "Request body is too large").
  - Anything else is logged (`[auth]` plus the error) and answered 500 "Something went wrong. Please try again.".
  - `readJsonBody`'s socket-error path no longer passes the socket's own message ("The request was cut off").
- **L2** (`backup.js`):
  - Each copy is `chmod 0600`, and the folder is created `0700`.
  - Every run also tightens the folder and the kept copies made before this version. A folder it can't change is left, and the new copy is still 0600.
  - README: "Off-site backups" (restic to object storage, encrypted before it leaves, a bucket-only token, the password in a password manager; rclone `crypt` as the alternative). It says what the copies hold, and to set `KIEAI_API_KEY` in the environment on a hosted server. "Automatic backups" mentions the modes.
- **L3** (`db/index.js`, `routes/spaces.js`):
  - `hiddenChannelNames(spaceId, userId)` lists the channels of that server the person can't view (threads included).
  - `listReports`, `countOpenReports` and `getModLog` take `hidden` and filter in SQL, so paging stays right. The log is filtered on `json_extract(details, '$.channel')`; lines with no channel are always shown.
  - Each moderator's `openReports` on `/spaces` and each `reports_changed` frame count only what they can see.
  - Resolving a report from an unseen channel is 404, and so is `DELETE` on a channel you can't view (after the `delete_channel` check).
- **L4:**
  - `verifyToken` refuses a token with no `sid`.
  - The gateway keeps each socket's token (`ws.token`, from the auth frame or the old `?token=`). Every `gatewayAuth.reverifyMs` (30 min) `reverifySockets` closes any whose token no longer verifies, whether expired, signed out, password changed or suspended: first `signed_out` with reason `expired`, then close 4001.
  - The app's sign-in page says "Your sign-in expired. Please sign in again." for that reason.
- **L5:** done in P11-07 (the upgrade's Origin check).
- **L6:** a taken username and a taken email both get 409 "That username or email can’t be used", on the first check and on the race path.
- **L7:**
  - `POST /spaces/:s/invites { expiresInDays?: 1|7|30|null, maxUses?: 1–1000 }`, defaulting to 7 days; `null` is never. Anything else is 400. It returns `{ code, expiresAt, maxUses }`.
  - The invite dialog has "Expires after" (1 day, 7 days, 30 days, Never). Changing it makes a new invite ("Changing it makes a new invite"); the earlier one keeps its own expiry.
  - The setup wizard's invite gets the 7-day default.
- **L9:**
  - **web:** vite `^8.3.2` → `^8.3.3`, locked at 8.3.3 (6 Oct; 8.3.4 is 13 days old, under the two-week rule). It's outside the launch-editor advisories' range (8.3.0–8.3.2).
  - **server:** `npm audit fix` for `brace-expansion` 2.1.7 / 1.1.21 and `js-yaml` 3.15.2. `overrides` pin the browserslist family to releases from before 7 Oct: browserslist 4.29.3, baseline-browser-mapping 2.11.27, caniuse-lite 1.0.30001814, electron-to-chromium 1.5.447, node-releases 2.0.57, update-browserslist-db 1.3.3. Left alone, audit fix would pick ones from 19–21 Oct.
  - The worktree's `node_modules` are junctions to the main checkout's, so only `package.json` and the lockfiles changed here (`--package-lock-only`). A clean `npm ci` in a scratch copy proved them (below).

## Verification Evidence
| Acceptance Criterion | Status | Verification Type | Evidence |
|---|---|---|---|
| AC-1 | Verified | Jest `low-severity-sweep.test.js` | With `createUserRedeemingCode` throwing "SQLITE_IOERR at /config/disgourd.db", `/register` answers `500 { error: 'Something went wrong. Please try again.' }` and the error is logged, not sent. A truncated JSON body gets `400 { error: 'Invalid JSON' }` (our words, no parser position) |
| AC-2 | Partly | Jest `backup.test.js` | Two tests: a new copy is `0600` in a `0700` folder, and a `0755` folder with a `0644` older copy are tightened. Both are **skipped on Windows** (this PC); CI runs them on Linux |
| AC-3 | Verified | Jest | With `#staff` owner-only: the admin (a moderator) gets only the `general` report, and the owner both. `/spaces` `openReports` is 1 vs 2. The admin resolving the `staff` report → 404. The admin's mod log has no "secret plans" line (`staff`) but keeps the `general` one and one with no channel; the owner sees all three. The admin deleting a hidden `#vault` → 404; the owner → 200. (The sandbox has no moderator with report rights and no private-channel reports to check live) |
| AC-4 | Verified | Jest | A token with no session → 401 on `/me`. A socket signed in with the auth frame stays open through a check, then closes 4001 at a check made with the clock 8 days on. `sessions.test.js` and `change-password.test.js` updated: a token from before sessions is refused; a version-less token with a session still counts as version 0 |
| AC-5 | Verified | Jest | Taken username and taken email: both `409 { error: 'That username or email can’t be used' }`; the concurrent-sign-up race (`transactions.test.js`) gives the same text |
| AC-6 | Verified | Jest; Vitest; sandbox | Default invite `expiresAt` ≈ now + 7 days and stored; 1 / 30 days, `null` + `maxUses: 5`; 3 days or `maxUses: 0` → 400; an expired invite → 410. Dialog test: the select shows 1 day / 7 days / 30 days / Never, and changing it calls `onExpiry(null)` / `onExpiry(30)`. Sandbox: Invite people → "Expires after 7 days", code iMP3fvCo stored with 7.000 days; Never → a new code XxROU_1W with no expiry |
| AC-7 | Verified | npm audit; clean install | **web:** 0 vulnerabilities. **server:** 0 high, 0 in production (`--omit=dev`); 19 moderate, all one dev-only chain (`sprintf-js` ≤1.1.3 DoS via `argparse` → `js-yaml` 3 → `@istanbuljs/load-nyc-config` → Jest). npm's only offered fix is downgrading to Jest 25, so they stay, listed here. Clean `npm ci` of the new lockfiles in a scratch copy: server 70 suites / 615 passed (2 skipped), resolving browserslist 4.29.3 (overridden), brace-expansion 1.1.21 + 2.1.7, js-yaml 3.15.2; web 110 files / 863 passed, `vite build` clean, vite 8.3.3. In the worktree: server 71 suites / 626 passed (1 skipped); web 110 files / 863 passed; build clean |

## Discovered Work (not done here)
- **Invites:** there's no list or revoke for a server's invites. Changing the expiry makes a new code, and the earlier one keeps working until its own expiry. A "Manage invites" page would fix both.
- **The Jest moderate chain** goes away when Jest moves off `js-yaml` 3 (via `@istanbuljs/load-nyc-config`). Recheck on the next Jest release.

## Expected Areas of Change
`server/routes/auth.js`, `server/backup.js`, `server/routes/spaces.js`, `server/db/index.js` (report and log filters), `server/auth/tokens.js`, `server/gateway/index.js`, the invite dialog in web, `server/package-lock.json`, `web/package.json` and lockfile, the README, tests.

## Not in scope
Anything not listed.
