# P1-16 — Nightly backups with `VACUUM INTO`

- **Unit Type:** Implementation
- **Phase:** 1 — Ops
- **State:** READY
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
- [ ] New `server/tests/backup.test.js`:
  - [ ] A temp-file DB with data plus `runBackup` produces a file whose `PRAGMA integrity_check` is `ok` and that contains the rows.
  - [ ] With `keep=2` and 4 runs, exactly 2 files remain (the newest).
  - [ ] An unwritable dir logs an error and resolves; the process doesn't crash.
- [ ] `api.test.js` is unaffected, and no timer leaks (jest exits cleanly).

## Expected Areas of Change
New `server/backup.js`, new `server/tests/backup.test.js`, `server/server.js` (boot block, about 3 lines), `README.md`, and `docker-compose.yml` (comment on where backups land).

## Working Set / Blast Radius
Small. The backup runs on the live connection. `VACUUM INTO` takes a read transaction and is fine with WAL.
