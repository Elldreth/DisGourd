# P2-14 — Presence modes: Online / Idle / Do Not Disturb / Invisible

- **Unit Type:** Implementation
- **Phase:** 2, rank 8 (part 2)
- **State:** PLANNED
- **Effort:** S–M
- **Depends on:** P1-01, P1-05 (gateway/delivery.js, broadcastPresence)
- **Requirement Source:** IMPROVEMENT-PLAN.md Phase 2 #8

## Current state (revalidated)
Presence is binary: `online` when there's at least one socket, `offline` otherwise. `idle` exists as a colour token, but nothing sets it.

## Scope
- Migration: `users.presence TEXT NOT NULL DEFAULT 'online'` (the chosen mode, which persists).
- Effective status shown to others:
  - offline if no sockets, or if the mode is `invisible`
  - otherwise the mode (`online`, `idle`, `dnd`)
  - auto-idle is a non-goal; idle is manual only
- `PATCH /me { presence }` validates the mode and broadcasts `presence { user, userId, status }` with the effective status. The member list `online: bool` becomes `status` (keep `online` too, for compatibility).
- Invisible users still receive everything, and their own client shows "Invisible".
- DND: the client suppresses P2-04 notifications and sounds (if P2-04 has landed; otherwise leave a TODO hook in `notify.js`).
- Client: a status picker in UserFooter (click the avatar to get a menu), and status dots in Avatar and MemberList (`online` lime, `idle` amber, `dnd` pink, offline grey).

## Acceptance criteria
- [ ] New `server/tests/presence.test.js`:
  - [ ] Setting `invisible`: co-members get `presence` with `status: 'offline'`, and the members list shows offline.
  - [ ] Setting `dnd`: co-members get `'dnd'`.
  - [ ] An invalid mode returns 400.
  - [ ] The mode persists across reconnects.
- [ ] Manual: the picker works, and dots update live in another browser.

## Expected Areas of Change
`server/db/migrations.js`, `server/db/index.js`, `server/routes/auth.js` (`/me`), `server/routes/spaces.js` (members), `server/gateway/{delivery,index}.js`, `web/src/components/{UserFooter,Avatar,MemberList}.jsx`, the client spaces hook (presence handler), and the test.

## Working Set / Blast Radius
~9 files. Presence fan-out is unchanged in volume.
