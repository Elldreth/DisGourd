# P11-12 — Case-insensitive usernames

- **Unit Type:** Implementation (child of P11-00)
- **Phase:** 11
- **State:** COMPLETE (merged in #228; build order 12)
- **Starting baseline:** main at 5917e47 (#226 merged)
- **Effort:** S–M
- **Depends on:** P11-01 (both touch registration and SITE_ADMINS matching)
- **Serialize with:** P11-01
- **Requirement Source:** P11-00 finding M6.

## Problem
`users.username` is `UNIQUE` but case-sensitive (`server/db/migrations.js:43`), and lookups are exact. `Sandy` can be registered next to `sandy` and impersonate them in DMs, mentions and member lists. Emails have the same issue (two accounts for one mailbox).

## Scope
- **A migration (next version):**
  - First it finds collisions: `SELECT lower(username) … GROUP BY 1 HAVING COUNT(*) > 1`, and the same for emails.
  - If any exist, it stops with a clear message listing them and how to rename one (a one-line SQL in the README). It never picks a winner on its own.
  - Then it creates `UNIQUE INDEX users_username_nocase ON users(username COLLATE NOCASE)` and the same for `email`.
- **Lookups:**
  - `getUserByUsername` and `getUserByEmail` use `COLLATE NOCASE`, so `@Sandy` mentions and `/dms/Sandy` find `sandy`. The stored spelling is what's shown.
  - `/register` checks case-insensitively and answers with the single message from P11-13's L6 if that has landed; otherwise today's.
  - `SITE_ADMINS` matching is case-insensitive.
- **Display:** no change.

## Acceptance criteria
- [x] AC-1: with `sandy` registered, registering `Sandy` → 409; logging in as `SANDY` with sandy's password works.
- [x] AC-2: a database that already has `bob` and `Bob` refuses to migrate, with a message naming both, and is left untouched (`user_version` unchanged).
- [x] AC-3: `@Sandy` in a message mentions `sandy`.
- [x] AC-4: the migration test passes on a copy of the current schema (`db-migrations.test.js`), and both suites pass.

## As built
- **Migration v34** (`server/db/migrations.js`):
  - It lists every username, and every email, that clashes with another apart from case, oldest account first.
  - If there are any, it throws inside the migration transaction, so nothing changes and `user_version` stays at 33. The message names each group (for example "usernames: sandy, Sandy") and gives the rename SQL, pointing at the README.
  - Otherwise it creates `users_username_nocase` and `users_email_nocase` (`UNIQUE … COLLATE NOCASE`).
- **Lookups** (`server/db/index.js`): `getUserByUsername`, `getUserByEmail`, `setSiteAdminByUsername`, the mention member lookup and the imagine bot's name check use `COLLATE NOCASE`. The stored spelling is what's returned and shown. A login with `SANDY` signs a token for `sandy`.
- **Registration:** the existing "already exists" check now ignores case, and the new index backs it up (a race still gets 409 through `SQLITE_CONSTRAINT_UNIQUE`). P11-13's single message hasn't landed, so the text is today's "User already exists".
- **Mentions:** `parseMentionUsernames` dedupes by lower case, and `addMentions` skips a user it has already resolved, so `@Sandy @SANDY` is one mention. In the web app, `mentionsUser` (row highlight) and markdown's "you" highlight compare without case.
- **`SITE_ADMINS`** (`server/config.js`): matched through the case-insensitive lookup; the remembered "applied/missing" entries are keyed by lower case (older entries are carried over), so changing `Sandy` to `sandy` in the env can't undo the P11-01 protection.
- **Already case-insensitive:** P11-08's per-account sign-in lock.
- **README:** "Case-insensitive usernames" under Updating, with the `sqlite3` rename and a `docker run … node -e` form (the image has no `sqlite3`).

## Verification Evidence
| Acceptance Criterion | Status | Verification Type | Evidence |
|---|---|---|---|
| AC-1 | Verified | Jest `usernames-nocase.test.js`; sandbox | Registering `Sandy` after `sandy` → 409; `sandra` with `SANDY@Example.com` → 409. Login as `SANDY` → 200, and `/me` says `sandy`. Sandbox: `POST /login` as `SANDY` → 200 (`/me`: sandy); registering `BOB` → 409 "User already exists"; signing in through the form as `SANDY` opened the app as sandy |
| AC-2 | Verified | Jest `db-migrations.test.js`; sandbox copy | A v33 database with bob/Bob and Amy@x.test/amy@X.test: the migration throws "…usernames: bob, Bob; emails: Amy@x.test, amy@X.test…" with the UPDATE example, `user_version` stays 33 and no index is created; after the renames it migrates. A copy of the sandbox DB with an added `Sandy` refused to boot with "usernames: sandy, Sandy" and stayed at 33 |
| AC-3 | Verified | Jest; Vitest; sandbox | `hey @Sandy and @SANDY` → `mentions: ['sandy']` and one row in `mentions`. Markdown: `@Sandy` is "you" for sandy. Sandbox: "p11-12 check @BOB now" stored a mention of bob (then deleted) |
| AC-4 | Verified | Jest, Vitest | `db-migrations.test.js` passes (a fresh DB at v34 refuses `BOB` after `bob` and `Bob@X.test` after `bob@x.test`). Server 68 suites / 586 tests; web 110 files / 856 tests; `vite build` clean. The real sandbox DB migrated to v34 with both indexes |
| SITE_ADMINS | Verified | Jest | `applySiteAdmins(['IVO'])` makes `ivo` a site admin |

## Discovered Work (not done here)
- **The live database:** it's young, so a clash is unlikely, but the first start of this version would refuse with the message if there is one. The README has the Docker rename.

## Expected Areas of Change
`server/db/migrations.js`, `server/db/index.js` (user lookups, mention resolution), `server/routes/auth.js`, `server/config.js` (SITE_ADMINS), the README, tests.

## Not in scope
Unicode confusables (usernames are ASCII-only already).
