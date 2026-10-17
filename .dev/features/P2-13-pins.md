# P2-13 — Pinned messages

- **Unit Type:** Implementation
- **Phase:** 2, rank 8 (part 1 of "Pins, custom status, DND/invisible")
- **State:** COMPLETE
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
- [x] New `server/tests/pins.test.js` covers:
  - [x] an admin pins, viewers get the frame, and the list returns it
  - [x] a member can't pin by default
  - [x] deleting the message removes the pin
  - [x] the 51st pin is rejected
  - [x] a non-viewer can't list pins
- [x] Manual: pin, see it in the panel, unpin.

## Expected Areas of Change
`server/db/migrations.js`, `server/db/index.js` (`DEFAULT_PERMISSIONS` and the pin functions), `server/gateway/chat.js`, `server/routes/spaces.js`, `web/src/util.js` (`PERMISSION_ACTIONS`), `web/src/components/{MessageActions,MessageList,ChatPanel}.jsx`, new `PinsPanel.jsx`, `web/src/api.js`, and the test.

## Working Set / Blast Radius
~10 files, at the upper bound. If needed, split it into server (+tests) and client.

## Evidence
Baseline: main at 9d0c16d (after #94). Branch `claude/p2-13-pins`.

| Acceptance criterion | Evidence |
|---|---|
| An admin pins: viewers get the frame, the list returns it | `server/tests/pins.test.js`: the admin's `pin` sends `message_pinned { id, space, channel, pinned: true, pinnedBy }` to owner, admin and member, and not to a stranger. History has `pinned: true`. `GET …/pins` returns it with `pinnedBy` and `pinnedAt`. Newest pin comes first. Unpin sends `pinned: false` and drops it from the list. |
| A member can't pin by default | The member's `pin` is refused with an error frame ("permission"), and nobody is told. With `pin_messages` set to 1, the member can pin. |
| Deleting the message removes the pin | Pin, then delete: gone from the list and from the `pins` table (cascade). |
| The 51st pin is rejected | With 50 pinned, the 51st gives an error frame mentioning 50, and the list stays at 50. |
| A non-viewer can't list pins | Staff-only channel → 403 for a member; a non-member → 403. A member with pin permission can't pin a message in a channel they can't see. |
| Manual: pin, see it in the panel, unpin | Sandbox (Tx Check #history). As sandy (owner): right-click a message → **Pin message**, and it showed "Pinned". The far-back original #641 was pinned through the gateway op. Header **Pinned messages** listed both, newest pin first. Clicking the #641 item closed the panel and **jumped through P2-10's history window**: loaded, highlighted, focused, marked Pinned, with the older-messages bar. **Unpin** in the panel left one item live, and #641 lost its marker. As bob (member): the pinned marker and header button were visible, and the message menu had **no** Pin action. |

Tests: server 223 (7 new; the migrations test now lists `idx_pins_channel`). Web 433 (PinsPanel 3, MessageList 2, reducer 1). Build clean.

### Notes
- `pin_messages` (default: admins) is added to `DEFAULT_PERMISSIONS`, so it shows in the server permissions dialog ("Pin messages").
- Every channel message row carries `pinned`. The PinsPanel reloads when `message_pinned` arrives for the open channel (`pinsVersion`).
- Each Unpin button in the panel names its message (found during the sandbox check: two plain "Unpin" buttons were ambiguous for screen readers).
- One full server run showed the 7 pins tests failing once; it didn't reproduce in 6 more runs (4 of them pins-only). These suites use short fixed waits, so it was most likely timing under load. Watch CI.
- DM pins are a non-goal (per scope).
