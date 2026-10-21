# P11-14 — Secrets from the environment; what backups carry

- **Unit Type:** Implementation (child of P11-00)
- **Phase:** 11
- **State:** READY
- **Effort:** S
- **Depends on:** none
- **Serialize with:** P11-13 (both touch `backup.js` and the README backup section). This goes first.
- **Requirement Source:** P11-00 "Hosting setups" → secrets at rest (raised by the hosting research: Litestream to R2, SMTP, TURN).

## Problem
- **JWT secret:** can come from the environment (`JWT_SECRET`). Otherwise it's a file in `/config`.
- **VAPID keys:** can only be a file (`server/push.js:11`, `/config/.vapid.json`).
- **kie.ai key:** typed into the app, it's stored in plain text in the database (`server/imagine/engines/kie.js:238`). `KIEAI_API_KEY` in the environment already wins.
- **Backups carry too much, and too little:**
  - Nightly backups and a Litestream replica contain the whole database (password hashes, every DM, and that saved kie.ai key), so it all goes to R2.
  - They don't contain `.jwt-secret` or `.vapid.json`, so a restore from R2 alone signs everyone out and breaks every push subscription.
- **Coming soon:** SMTP and R2 credentials will join these.

## Scope
- **VAPID:** `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` from the environment win over the file. Both or neither: one without the other stops the start with a clear message.
- **A one-off print:** `node server/push.js --print-env` (or a small `server/scripts/print-secrets-env.js`) prints the current file's keys as env lines for moving them into the host's secrets. It reads files only and changes nothing.
- **kie.ai:** at start, if `KIEAI_API_KEY` is set and a key is also saved in the database, log a warning ("a kie.ai key is also saved in the database and its backups; remove it in Settings → kie.ai"). On the kie.ai settings page, when the environment key is in use, show the saved key's "Forget it" button prominently.
- **`*_FILE` variants:** `JWT_SECRET_FILE` exists. Add `KIEAI_API_KEY_FILE` and `VAPID_PRIVATE_KEY_FILE`, read once at start, so Docker or compose secrets (`/run/secrets/...`) work without environment variables showing in `docker inspect`.
- **README, "Secrets and backups":**
  - The table of every secret, where it's read from, and what happens if it's lost: the JWT secret (everyone signs in again), VAPID (push subscriptions are lost), kie.ai, the future SMTP password, R2 keys and TURN secret.
  - The rule: secrets live in the host's secret store or env file (mode 0600, not in git, not in the image), never in `site_settings`.
  - What the database backups contain.
  - **Litestream:** a private R2 bucket with an API token scoped to that one bucket; its credentials go in Litestream's own environment, not DisGourd's; check the current Litestream release for client-side encryption and use it if it's there.
  - **Backing up the secrets themselves:** a password manager or the host's secrets, not the same bucket.
  - **A restore drill:** restore into the sandbox, with the secrets from the environment, and sign in.
- **A rule for later packets:** the email (SMTP) packet must take its password from the environment. It's written into this packet's "Not in scope" so it isn't missed.

## Acceptance criteria
- [ ] AC-1: with `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` set and no `.vapid.json`, the server starts, doesn't write the file, and `/push/vapid-key` returns the env public key.
- [ ] AC-2: one of the two set without the other → the start stops with the message (a test of the loader).
- [ ] AC-3: `KIEAI_API_KEY_FILE` pointing at a file is used like `KIEAI_API_KEY`.
- [ ] AC-4: the warning is logged when both an env key and a saved key exist, and not otherwise.
- [ ] AC-5: both suites pass.

## Expected Areas of Change
`server/push.js`, `server/imagine/engines/kie.js`, `server/config.js` (a shared `fromEnvOrFile` helper), `web/src/components/admin/imagine/KiePage.jsx` (the button's prominence), the README, tests (`push.test.js`, `imagine-kie.test.js`).

## Not in scope
- Encrypting secrets inside the database.
- The SMTP integration itself. When it's built, its password must come from the environment or a `_FILE`, never from `site_settings`.
