# P1-01 — Versioned migrations, pragmas, hot-path indexes

- **Unit Type:** Implementation
- **Phase:** 1 (Foundations) — IMPROVEMENT-PLAN.md "Versioned migrations", "Indexes", "More pragmas"
- **State:** REVIEW (PR open)
- **Effort:** M
- **Depends on:** none
- **Serialize with (shared files):** any unit editing `server/db/index.js` (P1-06, P1-07, P1-10, P2-05)
- **Requirement Source:** design/IMPROVEMENT-PLAN.md Phase 1; revalidated against `server/db/index.js` on 2026-10-15

## Value
Every schema-changing feature (replies, link-preview cache, pins, status, push subscriptions, custom emoji, bot user, roles) needs a migration story that is ordered, transactional and fails loudly. Today schema evolution is a ~100-line try/catch that logs and *continues* on error.

## Current state (revalidated)
- `PRAGMA foreign_keys = ON` + orphan cleanup: **DONE** (Phase 0.7, `db/index.js:227-263`). Not in scope.
- `journal_mode = WAL`: present. `busy_timeout`, `synchronous`: **missing**.
- `PRAGMA user_version`: never used. Migrations: `try { ... addCol ... } catch (e) { console.error }` at `db/index.js:117-225`.
- Indexes: none beyond PK/UNIQUE autoindexes. `messages(channel_id,id)`, `dm_messages(user_a,user_b,id)`, `mentions(user_id)` missing.

## Scope
1. New `server/db/migrations.js` exporting an ordered array `[{ version, name, up(db) }]` and `runMigrations(db)`.
2. **Migration 1 "baseline"**: the existing `CREATE TABLE IF NOT EXISTS` block + every existing `addCol`/`CREATE TABLE IF NOT EXISTS reg_codes/site_settings`. Must stay idempotent so DBs at `user_version = 0` in *any* historical partial state upgrade cleanly.
3. **Migration 2 "hot-path indexes"**: `CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id, id)`, `idx_dm_pair ON dm_messages(user_a, user_b, id)`, `idx_mentions_user ON mentions(user_id)`.
4. Each migration runs in `db.transaction`, and sets `user_version` inside the same transaction. On failure: log + **throw** (fail fast at boot).
5. Pragmas at open: `busy_timeout = 5000`, `synchronous = NORMAL` (safe with WAL).
6. Keep boot order: open → pragmas → migrations → site-admin bootstrap (stays a per-boot invariant, not a migration) → orphan cleanup → `foreign_keys = ON`.
7. Export `schemaVersion()` (or rely on `raw.pragma('user_version', { simple: true })`) for tests.

## Non-goals
- Down-migrations. Rewriting old tables (e.g. adding FK to `read_state`). Changing `read_state` keyed-by-name design.

## Acceptance criteria
- [x] Fresh `:memory:` DB ends at `user_version == LATEST` (2) with the three indexes present in `sqlite_master`.
- [x] A legacy DB file created with the *original* minimal schema (no `author_id`/`created_at`/`attachments`/... columns, `user_version = 0`) boots, gains all columns, ends at LATEST; existing rows preserved; `created_at` backfilled.
- [x] Booting twice is a no-op (no errors, version unchanged).
- [x] A migration that throws aborts boot with a clear error and leaves `user_version` at the previous value.
- [x] `PRAGMA busy_timeout` returns 5000; `PRAGMA synchronous` returns 1 (NORMAL).
- [x] `EXPLAIN QUERY PLAN` for `getMessages` uses `idx_messages_channel` (asserted in test).
- [x] `npm test` (existing `api.test.js`) passes unmodified.

## Expected Areas of Change
- `server/db/index.js` — replace lines ~8-225 with pragmas + `runMigrations(db)` call (~-110/+15 lines)
- `server/db/migrations.js` — new (~150 lines)
- `server/tests/db-migrations.test.js` — new; uses temp files + `jest.resetModules()` and sets `DB_PATH` per case

## Working Set / Blast Radius
- Load: `server/db/index.js` (~1100 lines; only lines 1-265 need close reading), new files, `server/tests/api.test.js` lines 1-30 (setup pattern).
- Blast radius: every DB consumer at boot. Mitigated by idempotent baseline and the unchanged existing suite.
- Shared-resource writes: `db/index.js` is a hot file (see Serialize list).

## Assumptions / Open questions
- DECIDED (user, 2026-10-15): a failed migration stops the server from starting (fail-fast), replacing log-and-continue.

## Activation
- Activated 2026-10-15 on branch `claude/p1-01-versioned-migrations`, cut from main @ d39c4e4.
- Baseline: 51/51 server tests passing (5 suites).

## Implementation notes
- A script moved the old `CREATE TABLE IF NOT EXISTS` block and every column check into migration 1 ("baseline") **verbatim** (re-indented only). The site-admin bootstrap stays in `db/index.js` as a per-boot step, as planned.
- `runMigrations(db, migrations = MIGRATIONS)` takes an optional list so the failure test can append a deliberately broken migration.
- Errors are rethrown as `Database migration N (name) failed: <cause>`, with `cause` kept.

## Verification (AC → evidence)
| AC | Evidence |
|---|---|
| Fresh DB → version 2 + 3 indexes | `db-migrations.test.js`: `user_version` 2; `idx_dm_pair`, `idx_mentions_user`, `idx_messages_channel` present. |
| Legacy minimal-schema DB upgrades | A test DB with the original 4 bare tables at `user_version` 0 gains all columns. Its row survives. `created_at` is backfilled to `Date.UTC(2025,5,1,12)`. `getMessages` reads it. The first user is promoted to site admin. |
| Booting twice is a no-op | Re-requiring against the same file: still version 2, still 1 user. |
| Failing migration aborts, version unchanged | Appended migration 3 creates a table, then throws. `runMigrations` throws "Database migration 3 (broken on purpose) failed: boom". `user_version` stays 2 and the table is rolled back. |
| Pragmas | `busy_timeout` 5000, `synchronous` 1 (NORMAL), `foreign_keys` 1. |
| Query plan uses the index | `EXPLAIN QUERY PLAN` for the channel-history shape mentions `idx_messages_channel`. |
| Existing suite unmodified | 6 suites, 57/57. ESLint on `db/`: clean. |
| (extra) the user's real DB | Read-only `VACUUM INTO` snapshot of `server/db/disgourd.db` (live `user_version` 0). Booting the copy gives version 2, integrity `ok`, identical row counts, the 3 indexes, and a second boot is a no-op. The live file was never opened for writing. |
