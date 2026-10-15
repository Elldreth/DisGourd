# P2-13 — Pinned messages

- **Unit Type:** Implementation
- **Phase:** 2, rank 8 (part 1 of "Pins, custom status, DND/invisible")
- **State:** PLANNED
- **Effort:** M
- **Depends on:** P1-01, P1-04 (routes/spaces.js), P1-05 (gateway), P3-05 (Pin action)
- **Requirement Source:** IMPROVEMENT-PLAN.md Phase 2 #8

## Scope
- Migration: `pins(message_id INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE, channel_id INTEGER, pinned_by INTEGER, pinned_at INTEGER)`, with an index on `channel_id`.
- New permission `pin_messages` in `DEFAULT_PERMISSIONS`, default rank 2. It shows up automatically in ServerPermissionsDialog through `PERMISSION_ACTIONS` in util.js; add a label there. Cap: 50 pins per channel.
- Gateway ops `pin` and `unpin` broadcast `message_pinned { id, space, channel, pinned }` to viewers. Pins are channel-only; DM pins are a non-goal.
- `GET /spaces/:s/channels/:c/pins` returns pinned messages, newest pin first. It is viewer-gated.
- Client: a "Pin"/"Unpin" action in MessageActions (shown only with permission), a pin icon on pinned messages, and a ChatPanel header button that opens a pins popover listing pinned messages. Clicking one jumps to it (if loaded; otherwise via `around` from P2-10 once that lands).

## Acceptance criteria
- [ ] New `server/tests/pins.test.js` covers:
  - [ ] an admin pins, viewers get the frame, and the list returns it
  - [ ] a member can't pin by default
  - [ ] deleting the message removes the pin
  - [ ] the 51st pin is rejected
  - [ ] a non-viewer can't list pins
- [ ] Manual: pin, see it in the panel, unpin.

## Expected Areas of Change
`server/db/migrations.js`, `server/db/index.js` (`DEFAULT_PERMISSIONS` and the pin functions), `server/gateway/chat.js`, `server/routes/spaces.js`, `web/src/util.js` (`PERMISSION_ACTIONS`), `web/src/components/{MessageActions,MessageList,ChatPanel}.jsx`, new `PinsPanel.jsx`, `web/src/api.js`, and the test.

## Working Set / Blast Radius
~10 files, at the upper bound. If needed, split it into server (+tests) and client.
