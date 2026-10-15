# P1-16 — Nightly backups with `VACUUM INTO`

- **Unit Type:** Implementation
- **Phase:** 1 — Ops
- **State:** COMPLETE (merged in Elldreth/DisGourd#46)
- **Effort:** S
- **Depends on:** none
- **Serialize with:** P1-02..P1-05 (one wiring line in the `server.js` boot block), P1-15 (README/compose)
- **Requirement Source:** IMPROVEMENT-PLAN.md Phase 1 Ops

## Scope
- New `server/backup.js` exporting `runBackup({ db, dir, keep })` and `startBackupSchedule({ db, dir, intervalHours, keep })`.
  - `runBackup` uses `db.prepare('VACUUM INTO ?').run(file)` with `file = <dir>/disgourd-YYYYMMDD-HHMMSS.db`, then prunes the oldest files beyond `keep`.
  - The schedule runs on start if the newest backup is older than the interval, then every interval. The timer is `unref()`'d. Errors are logged, never thrown.
- Env: `BACKUP_DIR` defaults to `<dirname(DB_PATH)>/backups`. Backups are disabled when `DB_PATH` is `:memory:` or `BACKUP_DIR=off`. Also `BACKUP_INTERVAL_HOURS=24` and `BACKUP_KEEP=7`.
- Wire it only inside `if (require.main === module)`, so tests never start the timer.
- README: a backup/restore section. Restore = stop the container and replace `disgourd.db` with a backup (delete the `-wal`/`-shm` files).

## Acceptance criteria
- [x] New `server/tests/backup.test.js`:
  - [x] A temp-file DB with data plus `runBackup` produces a file whose `PRAGMA integrity_check` is `ok` and that contains the rows.
  - [x] With `keep=2` and 4 runs, exactly 2 files remain (the newest).
  - [x] An unwritable dir logs an error and resolves; the process doesn't crash.
- [x] `api.test.js` is unaffected, and no timer leaks (jest exits cleanly).

## Expected Areas of Change
New `server/backup.js`, new `server/tests/backup.test.js`, `server/server.js` (boot block, about 3 lines), `README.md`, and `docker-compose.yml` (comment on where backups land).

## Working Set / Blast Radius
Small. The backup runs on the live connection. `VACUUM INTO` takes a read transaction and is fine with WAL.

## Activation
- Activated 2026-10-15 on branch `claude/p1-16-nightly-backups`, cut from main @ b60c56a.
- Baseline: 44/44 server tests passing (4 suites).

## Implementation notes
- `runBackup` and `startBackupSchedule` take an injectable `logger`, so tests stay quiet. `runBackup` also takes `now`, so tests get deterministic file names.
- The schedule reads the newest backup's file mtime to decide whether to back up on start.
- The wiring passes `db.raw` (the underlying better-sqlite3 connection the db module already exports).
- Timestamps in file names are UTC, so the names always sort chronologically.
- `server/db/backups/` is added to `.gitignore` and `.dockerignore` (the default location sits outside the existing `server/db/*.db` ignore patterns).

## Verification (AC → evidence)
| AC | Evidence |
|---|---|
| Backup is complete and consistent | `backup.test.js`: a WAL DB with 25 rows → the backup's `integrity_check` is `ok` and it holds 25 rows. |
| keep=2 and 4 runs → 2 newest remain | Exactly `…030002.db`, `…030003.db` remain. |
| Unwritable dir is logged, not thrown | The dir sits under a regular file. Result is `{ error }`, one error logged, no throw. |
| api.test unaffected, no timer leak | Full run: 5 suites, 51/51. The schedule's timer has `hasRef() === false`. The server only starts it inside `require.main === module`. |
| (extra) real boot | `node server/server.js` with a temp `DB_PATH` printed `Backups: every 24h to …/backups (keeping 7)` and wrote one backup (integrity `ok`, 16 tables). A restart within the interval made no second backup. |
