# P1-15 — Docker: non-root user, HEALTHCHECK, `npm ci`

- **Unit Type:** Implementation
- **Phase:** 1 — Ops
- **State:** READY
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
- **FLAG FOR HUMAN:** existing Unraid volumes are root-owned, because the container ran as root. Switching to non-root needs a one-time host chown. Confirm the UID/GID you want: 99:100 is the Unraid convention, 1000 is the image's `node` user.
