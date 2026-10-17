# P2-14 — Presence modes: Online / Idle / Do Not Disturb / Invisible

- **Unit Type:** Implementation
- **Phase:** 2, rank 8 (part 2)
- **State:** COMPLETE
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
- [x] New `server/tests/presence.test.js`:
  - [x] Setting `invisible`: co-members get `presence` with `status: 'offline'`, and the members list shows offline.
  - [x] Setting `dnd`: co-members get `'dnd'`.
  - [x] An invalid mode returns 400.
  - [x] The mode persists across reconnects.
- [x] Manual: the picker works, and dots update live in another browser.

## Expected Areas of Change
`server/db/migrations.js`, `server/db/index.js`, `server/routes/auth.js` (`/me`), `server/routes/spaces.js` (members), `server/gateway/{delivery,index}.js`, `web/src/components/{UserFooter,Avatar,MemberList}.jsx`, the client spaces hook (presence handler), and the test.

## Working Set / Blast Radius
~9 files. Presence fan-out is unchanged in volume.

## Evidence
Baseline: main at 3ff893e (after #92). Branch `claude/p2-14-dnd-invisible`.

| Acceptance criterion | Evidence |
|---|---|
| Invisible: co-members get `presence` `offline`; the members list shows offline | `server/tests/presence.test.js`: quinn gets `status: 'offline'`, and `/members` shows `{ status: 'offline', online: false }`. The invisible user still receives messages. Only their own sockets get `my_presence { mode: 'invisible' }`, and no other user's frames contain "invisible". |
| DND: co-members get `dnd` | Frame `status: 'dnd'`; members show `{ status: 'dnd', online: true }`. Idle, and back to online, also tested. |
| Invalid mode gives 400 | `'busy'` and `''` give 400. A presence-only PATCH leaves the avatar alone (it used to rewrite it on every PATCH). |
| Persists across reconnects | Invisible survives a disconnect and reconnect, and coming back never announces "online" to others. A mode set while disconnected shows once you connect. |
| Manual: the picker works, and dots update live in another browser | Sandbox, sandy (localhost) and bob (127.0.0.1). A real click opened sandy's status menu; Do Not Disturb made bob's view of sandy turn pink, read "sandy, Do Not Disturb", and stay in Online. **Keyboard only** (Enter, ↓, Enter) set Invisible: sandy's footer said Invisible, and in bob's view she moved to **Offline — 1** with a grey dot. After reloading sandy's tab: still Invisible, and bob still saw offline. A PATCH back to online turned bob's dot lime, and sandy's open tab updated itself (the `my_presence` sync). |

Tests: server 209 (7 new). Web 421 (5 Presence, 1 notify DND, plus a menu-name check). Build clean.

### What changed
- **Server:** migration 5 adds `users.presence`. `effectiveStatus()` returns offline when not connected or invisible, otherwise the mode. `broadcastPresence(userId)` sends the effective status. `PATCH /me { presence }` validates and broadcasts, and sends `my_presence` to your own sockets. `/me` returns `presence`. `/members` returns `status` (and `online` for compatibility). `PATCH /me` fields are now each optional.
- **Client:**
  - Avatar dots: online lime, idle amber, dnd pink, offline grey.
  - MemberList groups by status, and each member gets their own dot plus spoken words ("Idle", "Do Not Disturb").
  - UserFooter: click your avatar for a status menu (`menuitemradio`, arrow keys, Esc returns focus). The line under your name shows your status unless the connection is in trouble.
  - Do Not Disturb turns off desktop notifications and sounds; unread badges still count.
