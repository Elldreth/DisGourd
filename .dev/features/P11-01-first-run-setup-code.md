# P11-01 — First-run setup code; safe SITE_ADMINS

- **Unit Type:** Implementation (child of P11-00)
- **Phase:** 11
- **State:** COMPLETE (merged in #215 and deployed; the live /auth-info shows setupCode:true)
- **Effort:** S
- **Depends on:** none
- **Serialize with:** P11-12 (both touch registration). This goes first.
- **Requirement Source:** P11-00 finding C1 (Critical on a fresh public instance).

## Problem
On an instance with no accounts, `POST /register` skips the registration mode and code checks, and the new account becomes site admin (`server/routes/auth.js:62`, `server/db/index.js:1926-1930`). `/auth-info` tells anyone `setup: true`. Whoever finds a fresh instance first owns it.

`SITE_ADMINS` (`server/config.js:47`) promotes those usernames on every boot. A stranger who registers a listed name that isn't taken yet becomes admin on the next restart. A site admin demoted in the app is also promoted again on every restart.

## Scope
- **Setup code:** at boot, when `countUsers() === 0`, read or create `<config dir>/.setup-code` (random, 0600, next to `.jwt-secret`). Print it once in the start-up banner: "First run: your setup code is …". `SETUP_CODE` in the environment overrides the file.
- **First account:** the first `/register` must carry `setupCode` matching it (constant-time compare). Without it the answer is 403 "This server needs its setup code (see the server log)". Once the first account exists, the file is deleted and the code is ignored.
- **The wizard** (`web/src/components/SetupWizard.jsx`) gets a "Setup code" field with a hint ("It's in the server's log, or in /config/.setup-code").
- **`/auth-info`:** keep `setup`, since the wizard needs it. Exposing it is harmless once a code is required.
- **SITE_ADMINS:** promote only names that exist. Log a warning for a listed name that doesn't. Apply each name once: record the applied names in `site_settings`, so a later in-app demotion isn't undone at the next boot. The README says this.

## Acceptance criteria
- [x] AC-1: on an empty instance, `/register` without the code → 403; with a wrong code → 403; with the right code → 201 and site admin.
- [x] AC-2: `REGISTRATION_MODE=closed` on an empty instance: the first account still works with the setup code; a second registration → 403.
- [x] AC-3: the setup code file is removed after the first account, and a restart doesn't make a new one.
- [x] AC-4: `SITE_ADMINS=ghost` with no user `ghost`: a warning is logged. Registering `ghost` later and restarting doesn't make them admin; the operator makes them admin in Settings (documented).
- [x] AC-5: an admin listed in `SITE_ADMINS` and demoted in the app stays demoted after a restart.
- [x] AC-6: the wizard asks for and sends the code; its tests are updated.

## As built
- **`server/config.js`:**
  - `ensureSetupCode()` runs at load when there are no accounts. It uses `SETUP_CODE`, else a saved `.setup-code` (12+ characters), else 16 random base64url characters written 0600. The path is `SETUP_CODE_FILE` or next to `.jwt-secret`, so `/config/.setup-code` in Docker.
  - `checkSetupCode()` compares in constant time; `clearSetupCode()` deletes the file.
  - `config.requireSetupCode` is on everywhere except `NODE_ENV=test`, where `REQUIRE_SETUP_CODE=1` turns it on (the same pattern as `config.rateLimit`). Every other suite registers its first user on an empty in-memory DB.
- **`applySiteAdmins(names)`** keeps `site_admins_seen` in `site_settings`: `applied` (promoted once) or `missing` (never promoted later).
  - A missing name that later appears and isn't an admin gets a warning pointing to Settings.
  - On existing installs, the first boot after this promotes the listed accounts that exist (as before), then never again.
- **`POST /register`:** the first account needs `setupCode`, else 403 "This server needs its setup code to create the first account. It's in the server's log, or in the .setup-code file next to the database." After it's created, the code is cleared.
- **`/auth-info`** adds `setupCode: true` while the code is needed.
- **`server/server.js`** prints `First run: no accounts yet. Your setup code is …` and where it's saved.
- **Web:**
  - `SetupWizard` takes `needsCode` (from `/auth-info`), showing a "Setup code" field first, with a line saying where to find it.
  - `api.register(…, setupCode)`.
  - `App` passes the flag.
- **`deploy/docker-smoke.sh`** reads `/config/.setup-code` from the container, checks that `/auth-info` asks for it and that registering without it is refused (403), then registers with it.
- **README:** a first-run paragraph, plus `SITE_ADMINS` and `SETUP_CODE` in the table.

## Verification Evidence
| Acceptance Criterion | Status | Verification Type | Evidence |
|---|---|---|---|
| AC-1 | Verified | Jest `setup-code.test.js` + fresh install | No code → 403 with the message; wrong → 403; right → 201, `/me` siteAdmin true. Fresh install (:3006, its own temp DB): a wrong code in the wizard shows the server's message; the code from `.setup-code` moves on to step 2 |
| AC-2 | Verified | Jest + fresh install | `REGISTRATION_MODE=closed` in both. A second registration → 403, even with the old code |
| AC-3 | Verified | Jest + fresh install | The file is gone after the first account; `ensureSetupCode()` (what boot does) returns null and writes nothing. `/auth-info` → `{"registration":"closed","setup":false}` |
| AC-4 | Verified | Jest + fresh install log | `ghost` listed before it existed is not promoted after registering and a restart; the warning names Settings. The fresh install logged `SITE_ADMINS lists "<owner>", but there's no such account…` |
| AC-5 | Verified | Jest | `ivy` promoted once, demoted through the admin API, still demoted after `applySiteAdmins` runs again |
| AC-6 | Verified | Vitest `SetupWizard.test.jsx` + fresh install screenshot | The field shows only with `needsCode`; the trimmed code is sent as the 5th argument; a refusal shows the server's message on step 1 |
| Existing instance | Verified | Sandbox :3005 (restarted on this branch) | `/auth-info` → `{"registration":"open","setup":false}` (no `setupCode`); sandy signs in; no `.setup-code` written |
| Docker smoke | Not run here | `bash -n` only | No Docker on this machine; CI runs `deploy/docker-smoke.sh` |
| Suites | Verified | Jest, Vitest | Server 56 suites / 505 tests; web 106 files / 841 tests |

## The live server after this deploys
Step 0 in P11-00 becomes simpler: start the container, read the code (`docker logs disgourd`, or `/mnt/cache/appdata/disgourd/.setup-code`), open the site, and enter it in the wizard. Until this is deployed, keep `cloudflared` stopped while creating the account, as Step 0 says.

## Discovered Work (not done here)
- `SITE_ADMINS` still matches names exactly (case-sensitive). P11-12 makes usernames case-insensitive.
- Two people with the code registering at the same moment could both get past the check (the count is read before the insert). Only the operator has the code, so this is left as is.

## Not in scope
Email verification and two-factor (see P11-00 Discovered Work).
