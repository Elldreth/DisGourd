# P1-09 — Resync everything on WebSocket reconnect

- **Unit Type:** Implementation
- **Phase:** 1 — "Resync everything on WebSocket reconnect, not just the open channel"
- **State:** PLANNED
- **Effort:** S–M
- **Depends on:** P1-05 (gateway/index.js connect frames), P1-08 (merge semantics must keep older pages), P1-14 (all client state in hooks)
- **Requirement Source:** IMPROVEMENT-PLAN.md Phase 1

## Current state (revalidated)
- On connect, the server already sends `ready`, `unread` (with mentions) and `dm_unread`.
- The client reloads only the open channel/DM history (wholesale replace, last 50) and the member list (effects keyed on `status`).
- **Not resynced:** the space list (channels created or deleted while offline, role changes), the DM conversation list, and voice participant state. The server never sends `voice_state` on connect, so voice channel occupancy is blank until someone joins or leaves.
- **Bug:** `dm_unread` arrives as `{ other, count }`, but App.jsx reads `c.with`, so DM unread badges are lost on every (re)connect. This is fixed separately in P1-11. If P1-11 hasn't landed, fold the fix in here.
- Edits, deletes and reactions that happen while you're offline are invisible after reconnect if they're outside the refetched window.

## Scope
- Server (`gateway/index.js`): after the `unread` frames, send one `voice_state` per active voice room the user can view.
- Client: on the transition `reconnecting → open` (not the first `connecting → open`), run `loadSpaces()`, `refreshMembers`, and `loadDms()` (if in DM view or the list is loaded). For the open channel/DM: refetch the newest page and *replace overlapping ids* (this picks up edits and reactions), drop ids in that range that are missing (deleted), and keep older loaded pages as they are (stale edits there are accepted; document it).
- If the open channel was deleted or became hidden while offline, fall back to the existing "first visible channel" logic.

## Acceptance criteria
- [ ] New server test `server/tests/reconnect.test.js`: user A is in voice, user B connects, and B's first frames include `voice_state` with A.
- [ ] Manual: kill the network, then on another account create a channel, edit a message, react, delete a message, send a DM and join voice. Restore the network: all of these show up within 2s without a page reload.
- [ ] Loaded older pages survive the reconnect: scroll position and loaded count are unchanged.

## Expected Areas of Change
`server/gateway/index.js`, client hooks (`web/src/state/*`), `web/src/useSocket.js` (expose the previous status or a `reconnects` counter), and the new test.

## Working Set / Blast Radius
~5 files. Touches the gateway connect path, which every user hits on every connect, so keep the added frames small.
