# P11-14 — Secrets from the environment; what backups carry

- **Unit Type:** Implementation (child of P11-00)
- **Phase:** 11
- **State:** COMPLETE (merged in #223; build order 9 in P11-00)
- **Starting baseline:** main at 7590c22 (#222 merged)
- **Effort:** S
- **Depends on:** none
- **Serialize with:** P11-13 (both touch `backup.js` and the README backup section). This goes first.
- **Requirement Source:** P11-00 "Hosting setups" → secrets at rest (raised by the hosting research: Litestream to R2, SMTP, TURN).

## Problem
> **The live setup (2026-10-21):** `JWT_SECRET` isn't set, so the generated `/config/.jwt-secret` is used, and VAPID is in `/config/.vapid.json`. Both sit on the cache drive next to the database and its nightly backups, on the same box. The first step, before any code: copy `/config` off the box (including those two files) and keep `TUNNEL_TOKEN` out of git and backups. Litestream to R2 is still only planned.

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
- [x] AC-1: with `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` set and no `.vapid.json`, the server starts, doesn't write the file, and `/push/vapid-key` returns the env public key.
- [x] AC-2: one of the two set without the other → the start stops with the message (a test of the loader).
- [x] AC-3: `KIEAI_API_KEY_FILE` pointing at a file is used like `KIEAI_API_KEY`.
- [x] AC-4: the warning is logged when both an env key and a saved key exist, and not otherwise.
- [x] AC-5: both suites pass.

## As built
- **`server/secrets.js` (new):** `secretFromEnv(NAME)` returns `NAME`, else the contents of the file named by `NAME_FILE` (trimmed, read once and remembered). A `NAME_FILE` that can't be read throws, naming the variable and the path, so a typo stops the start. It's its own module rather than in `config.js`, because `config.js` loads the database and writes `.jwt-secret` as it loads.
- **`server/push.js`:** `vapidFromEnv()` reads `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` (or `VAPID_PRIVATE_KEY_FILE`). Both set: those keys are used and `.vapid.json` is neither read nor written. Neither set: the file, or a new pair, as before. One alone: the start stops with "Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY (or VAPID_PRIVATE_KEY_FILE) both, or neither". `loadKeys()` takes `{ env, file, ephemeral }` so tests can exercise the non-test path.
- **`server/imagine/engines/kie.js`:** the key is `KIEAI_API_KEY`, else `KIEAI_API_KEY_FILE`, else the saved one. `duplicateKeyWarning(cfg)` returns the warning when the environment has a key and one is also saved. `imagine.start()` logs it at start.
- **`JWT_SECRET_FILE`** already existed (the path of the generated secret, which can also point at a Docker secret); now documented.
- **`server/scripts/print-secrets-env.js` (new):** `node server/scripts/print-secrets-env.js [/config]` prints `JWT_SECRET=`, `VAPID_PUBLIC_KEY=` and `VAPID_PRIVATE_KEY=` from the folder's `.jwt-secret` and `.vapid.json`. It reads only; a reminder that these are secrets goes to stderr.
- **Settings › Image generation › kie.ai:** when a key is saved there, a "Forget the saved key" button. With the environment's key in use, it's in a highlighted note: "A key (••••1234) is also saved in the database, and so in its backups…". Clicking it marks the draft ("The saved key will be removed when you save"), and Save sends `apiKey: null`. The server's existing rule still applies: kie.ai can't stay on without a key from somewhere.
- **README:** `JWT_SECRET_FILE`, `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` and `KIEAI_API_KEY` (with their `_FILE` forms) in the table, and a new "Secrets and backups" section:
  - the table of secrets, where each is read from, and what losing it does;
  - the rule (host secret store or 0600 env file, never `site_settings`);
  - the print script;
  - what the backups contain (and don't);
  - Litestream to R2 with a private bucket and a token for that bucket only. Litestream 0.5.x has no client-side encryption: `age` was removed after 0.3.x (litestream.io config reference, checked 2026-10-21), so the README says so instead of recommending it;
  - backing up the secrets apart from the database;
  - a restore drill.

## Verification Evidence
| Acceptance Criterion | Status | Verification Type | Evidence |
|---|---|---|---|
| AC-1 | Verified | Jest `secrets.test.js`, `push-env.test.js` | `loadKeys` with both env keys, a temp `.vapid.json` path and the non-test path returns the env pair and leaves no file. A server started with the env keys answers `/push/vapid-key` with `{ key: <env public key> }`. `VAPID_PRIVATE_KEY_FILE` works too |
| AC-2 | Verified | Jest `secrets.test.js` | Only the public key, or only the private key → throws "…both, or neither…" |
| AC-3 | Verified | Jest `secrets.test.js` | `KIEAI_API_KEY_FILE` pointing at a file: `keyOf` returns its contents over a saved key, and `envKey` is true. An unreadable `*_FILE` throws, naming the variable and the path |
| AC-4 | Verified | Jest; sandbox DB copy | Unit: no env key → no warning; env key and nothing saved → none; both → the warning. Then `imagine.start()` against a copy of the sandbox DB with a dummy key saved: silent without `KIEAI_API_KEY`, and the warning with it |
| AC-5 | Verified | Jest, Vitest | Server 64 suites / 562 tests; web 107 files / 846 tests; `vite build` clean |
| UI | Verified | Vitest `ImagineAdmin.test.jsx`; sandbox :3005 | Tests: the highlighted note and its button with an env key, Save sends `apiKey: null`, and the quiet button without one. Sandbox: saved a dummy key → "A key is saved (••••0000)" and the quiet button. Forget → the note. Save with kie.ai on → refused ("Add an API key…"), as designed. kie.ai off → saved, the key gone. Then the sandbox's own state was restored (kie.ai on, no key) |

## Discovered Work (not done here)
- **TURN relays and the CSP (from P11-06):** the README's voice section says to set `window.__DISGOURD_ICE__` "via a small inline script". With P11-06's `script-src 'self'`, an inline script is now blocked. Nobody uses a TURN relay today, but the advice no longer works. A small fix: serve an optional `/ice.js` (or an `ICE_SERVERS` setting the client fetches) and update the README.

## Expected Areas of Change
`server/push.js`, `server/imagine/engines/kie.js`, `server/config.js` (a shared `fromEnvOrFile` helper), `web/src/components/admin/imagine/KiePage.jsx` (the button's prominence), the README, tests (`push.test.js`, `imagine-kie.test.js`).

## Not in scope
- Encrypting secrets inside the database.
- The SMTP integration itself. When it's built, its password must come from the environment or a `_FILE`, never from `site_settings`.
