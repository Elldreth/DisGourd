# P11-01 — First-run setup code; safe SITE_ADMINS

- **Unit Type:** Implementation (child of P11-00)
- **Phase:** 11
- **State:** READY
- **Effort:** S
- **Depends on:** none
- **Serialize with:** P11-12 (both touch registration). This goes first.
- **Requirement Source:** P11-00 finding C1 (Critical on a fresh public instance).

## Problem
On an instance with no accounts, `POST /register` skips the registration mode and code checks, and the new account becomes site admin (`server/routes/auth.js:62`, `server/db/index.js:1926-1930`). `/auth-info` tells anyone `setup: true`. Whoever finds a fresh cloud instance first owns it.

`SITE_ADMINS` (`server/config.js:47`) promotes those usernames on every boot. A stranger who registers a listed name that isn't taken yet becomes admin on the next restart. A site admin demoted in the app is also promoted again on every restart.

## Scope
- **Setup code:** at boot, when `countUsers() === 0`, read or create `<config dir>/.setup-code` (random, 0600, next to `.jwt-secret`). Print it once in the start-up banner: "First run: your setup code is …". `SETUP_CODE` in the environment overrides the file.
- **First account:** the first `/register` must carry `setupCode` matching it (constant-time compare). Without it the answer is 403 "This server needs its setup code (see the server log)". Once the first account exists, the file is deleted and the code is ignored.
- **The wizard** (`web/src/components/SetupWizard.jsx`) gets a "Setup code" field with a hint ("It's in the server's log, or in /config/.setup-code").
- **`/auth-info`:** keep `setup`, since the wizard needs it. Exposing it is harmless once a code is required.
- **SITE_ADMINS:** promote only names that exist. Log a warning for a listed name that doesn't. Apply each name once: record the applied names in `site_settings`, so a later in-app demotion isn't undone at the next boot. The README says this.

## Acceptance criteria
- [ ] AC-1: on an empty instance, `/register` without the code → 403; with a wrong code → 403; with the right code → 201 and site admin.
- [ ] AC-2: `REGISTRATION_MODE=closed` on an empty instance: the first account still works with the setup code; a second registration → 403.
- [ ] AC-3: the setup code file is removed after the first account, and a restart doesn't make a new one.
- [ ] AC-4: `SITE_ADMINS=ghost` with no user `ghost`: a warning is logged. Registering `ghost` later and restarting doesn't make them admin until the operator re-applies (documented).
- [ ] AC-5: an admin listed in `SITE_ADMINS` and demoted in the app stays demoted after a restart.
- [ ] AC-6: the wizard asks for and sends the code; its tests are updated.

## Expected Areas of Change
`server/config.js`, `server/routes/auth.js`, `server/db/index.js` (createUser stays the place where the first account becomes admin), `server/server.js` (banner), `web/src/components/SetupWizard.jsx` and `web/src/api.js`, the README (first run, SITE_ADMINS), tests (`server/tests/api.test.js` or a new `setup-code.test.js`, `SetupWizard.test.jsx`).

## Tests
Turn the C1 part of `.dev/security/p11-00-proof.js` into Jest: an in-memory DB with `REGISTRATION_MODE=closed`; register without and with the code.

## Not in scope
Email verification and two-factor (see P11-00 Discovered Work).
