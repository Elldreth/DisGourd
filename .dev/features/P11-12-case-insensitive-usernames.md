# P11-12 — Case-insensitive usernames

- **Unit Type:** Implementation (child of P11-00)
- **Phase:** 11
- **State:** PLANNED (after P11-01). Build order 12.
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
- [ ] AC-1: with `sandy` registered, registering `Sandy` → 409; logging in as `SANDY` with sandy's password works.
- [ ] AC-2: a database that already has `bob` and `Bob` refuses to migrate, with a message naming both, and is left untouched (`user_version` unchanged).
- [ ] AC-3: `@Sandy` in a message mentions `sandy`.
- [ ] AC-4: the migration test passes on a copy of the current schema (`db-migrations.test.js`), and both suites pass.

## Expected Areas of Change
`server/db/migrations.js`, `server/db/index.js` (user lookups, mention resolution), `server/routes/auth.js`, `server/config.js` (SITE_ADMINS), the README, tests.

## Not in scope
Unicode confusables (usernames are ASCII-only already).
