# P11-13 — Low-severity sweep

- **Unit Type:** Implementation (child of P11-00)
- **Phase:** 11
- **State:** PLANNED (build order 14, last in Phase 11: it touches files several other units change)
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
- [ ] AC-1: a forced throw in `/register` answers without its message text.
- [ ] AC-2: a new backup file is mode 0600 (skipped on Windows).
- [ ] AC-3: a moderator who can't view #secret sees no reports or log excerpts from it, and can't delete it.
- [ ] AC-4: a hand-made token without `sid` → 401. A socket whose token expires is closed within a heartbeat-check period (the test uses a short interval).
- [ ] AC-5: a duplicate username and a duplicate email get the same 409 text.
- [ ] AC-6: a default invite has an expiry; "never" still works.
- [ ] AC-7: `npm audit` reports 0 high in both packages (or the remaining ones are listed with a reason). Both suites and `vite build` pass.

## Expected Areas of Change
`server/routes/auth.js`, `server/backup.js`, `server/routes/spaces.js`, `server/db/index.js` (report and log filters), `server/auth/tokens.js`, `server/gateway/index.js`, the invite dialog in web, `server/package-lock.json`, `web/package.json` and lockfile, the README, tests.

## Not in scope
Anything not listed.
