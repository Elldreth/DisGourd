# P1-15 — Docker: non-root user, HEALTHCHECK, `npm ci`

- **Unit Type:** Implementation
- **Phase:** 1 — Ops
- **State:** COMPLETE
- **Effort:** S
- **Depends on:** none
- **Serialize with:** P1-16 (both edit README.md / docker-compose.yml)
- **Requirement Source:** IMPROVEMENT-PLAN.md Phase 1 Ops; Dockerfile revalidated on 2026-10-15 (runs as root, `npm install`, no HEALTHCHECK)

## Scope
- The build stage uses `npm --prefix server ci --omit=dev` and `npm --prefix web ci`. Both lockfiles exist.
- Runtime: `RUN mkdir -p /config /uploads && chown node:node /config /uploads`, then `USER node`.
- `HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/auth-info').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"`. Node 22 has global fetch.
- docker-compose.yml: document `user: "99:100"` for Unraid (nobody:users) as a commented option.
- README: an "Upgrading to the non-root image" note with a one-time `chown -R 99:100 /mnt/user/appdata/disgourd /mnt/user/bigboi/media/images` (or 1000:1000 if not using `user:`).
- Check that `.dockerignore` excludes `node_modules`, `web/dist`, `.git`, `design/`, `uploads/` and `*.db`.

## Acceptance criteria
- [ ] `docker build .` succeeds. `docker run` shows `healthy` within 60s.
- [ ] `docker exec <c> id -u` is not 0.
- [ ] With a fresh volume, register, upload a file and restart: data persists.
- [ ] With the existing root-owned volume and no chown: the container logs a clear write error (document this). After the README chown, it works.

## Expected Areas of Change
`Dockerfile`, `docker-compose.yml`, `README.md`, `.dockerignore`.

## Working Set / Blast Radius
4 small files. Blast radius: the production deployment on Unraid.

## Assumptions / Open questions
- ~~**FLAG FOR HUMAN:**~~ **Answered 2026-10-17: 99:100.** Existing Unraid volumes are root-owned, because the container ran as root. Switching to non-root needs a one-time host chown. Confirm the UID/GID you want: 99:100 is the Unraid convention, 1000 is the image's `node` user.

## Evidence
Baseline: main after #90 (P2-23). Branch `claude/p1-15-docker-hardening`.

**There's no Docker on the dev machine**, so the container criteria are proven by CI instead. The existing "Docker image builds" job now also runs `deploy/docker-smoke.sh` on GitHub's Ubuntu runner (real Docker). It runs the image as 99:100 with host folders. **Result (PR #91, run 39006668509, all green):** healthy after 6s; `uid=99 gid=100`; register → upload → restart → login + file OK, DB file on the host owned by 99:100; root-owned volumes → exit 1 with "DisGourd can't write to its data folders (running as 99:100)" + `EACCES` for both folders → after `chown -R 99:100` healthy after 6s; "Docker smoke test passed."

| Acceptance criterion | Evidence |
|---|---|
| `docker build .` succeeds; `healthy` within 60s | CI: build with `npm ci`; the smoke test waits for `State.Health.Status = healthy` (HEALTHCHECK: `fetch /auth-info`, interval 30s). |
| `id -u` is not 0 | CI smoke test: `docker exec … id -u` / `id -g` must be 99 / 100. The image default is `USER node` (1000). |
| Fresh volume: register, upload, restart, and data persists | CI smoke test: register, `POST /uploads`, `docker restart`, wait for healthy; login works and the upload's bytes come back. The DB file on the host is owned by 99:100. |
| Root-owned volume: clear write error; works after the README chown | CI smoke test: root-owned host folders give exit code 1 and the log contains "DisGourd can't write to its data folders (running as 99:100)" plus EACCES. After `chown -R 99:100` it becomes healthy. **Locally verified too:** booting the real server with its data folder blocked by a file gives exit 1, that message (EEXIST/ENOTDIR) and no stack trace; nothing starts. `server/tests/preflight.test.js` (3 tests). |

Server tests: 194 pass (3 new). Web unaffected.

### What changed
- **Dockerfile:** `npm ci` (both lockfiles); `/config` and `/uploads` are owned by `node`; `USER node`; a HEALTHCHECK. The app files stay root-owned, so the process can't modify them.
- **docker-compose.yml:** `user: "99:100"` is on (the user's Unraid UID/GID), with the one-time chown in a comment.
- **server/preflight.js:** checks before the database or secret file are touched that the DB and uploads folders are writable. If not, it prints one clear message with the user it runs as and the chown fix, then exits 1. Without it, the first failure was an EACCES stack trace from writing `/config/.jwt-secret`.
- **README:** a non-root note plus "Upgrading to the non-root image" (the expected message, and `chown -R 99:100 <appdata> <uploads share>`).
- **.dockerignore:** now also leaves out `design/`, `.dev/`, `deploy/`, and any `*.db`, `*.db-*` or `.jwt-secret` anywhere.

### For the user (one time, on Unraid, before pulling this image)
```
chown -R 99:100 /mnt/user/appdata/disgourd /mnt/user/bigboi/media/images
```
