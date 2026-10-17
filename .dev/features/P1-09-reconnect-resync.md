# P1-09 — Resync everything on WebSocket reconnect

- **Unit Type:** Implementation
- **Phase:** 1 — "Resync everything on WebSocket reconnect, not just the open channel"
- **State:** COMPLETE (merged in #64)
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
- [x] New server test `server/tests/reconnect.test.js`: user A is in voice, user B connects, and B's first frames include `voice_state` with A.
- [x] Manual: kill the network, then on another account create a channel, edit a message, react, delete a message, send a DM and join voice. Restore the network: all of these show up within 2s without a page reload.
- [x] Loaded older pages survive the reconnect: scroll position and loaded count are unchanged.

## Expected Areas of Change
`server/gateway/index.js`, client hooks (`web/src/state/*`), `web/src/useSocket.js` (expose the previous status or a `reconnects` counter), and the new test.

## Working Set / Blast Radius
~5 files. Touches the gateway connect path, which every user hits on every connect, so keep the added frames small.

## Evidence
| Check | Result |
|---|---|
| `server/tests/reconnect.test.js` (2): a connecting user gets `voice_state` for an occupied room right after `dm_unread`; rooms they can't see, servers they're not in, and empty rooms are left out | pass (failed first) |
| `useChannelMessages.test.js` (+4): `resynced` replaces the overlap (edits), drops deleted ids, keeps older pages; a short page is the whole conversation; `hasGap` | pass |
| `useChannelMessages.resync.test.js` (2): 80 loaded across two pages, reconnect with an edit, a delete and a new message: 1-81 minus 75, edit applied; >1 page missed while away reloads the newest page instead of leaving a hole | pass (the first fails on the old wholesale replace) |
| `useSocket.test.js` (3): `reconnects` counts re-opens, not the first open; an `online` event retries at once and the cancelled timer doesn't open a second socket; `online` while connected does nothing | pass |
| Full suites | web 120/120, server 76/76, lint clean, `vite build` ok |
| Sandbox (sandy in #random with 3 pages / 150 loaded; new sockets blocked and the live one dropped, "Reconnecting…" shown). While offline: a text and a voice channel created, bob edited one message, reacted to one, deleted one, DMed sandy, joined voice. On reconnect: new channels listed, bob shown in the voice channel, edit / reaction / deletion shown, DM badge counts it; first loaded message and scroll position unchanged (150 -> 149, the deleted one) | pass |
| Sandbox: offline ~6s (backoff grown), then network restored with an `online` event: a channel created meanwhile appeared 60 ms later | pass |

## Implementation notes
- Server: `voiceStatesFor(userId)` in `gateway/voice.js`; `gateway/index.js` sends those frames after `dm_unread`. Only occupied rooms the user can view.
- `useSocket` exposes `reconnects`. `useSpaces` reloads the server list on it (and goes to the first server if yours is gone; an empty list = failed request, left alone); a deleted/hidden channel falls back through the existing effect. `useDms` reloads the conversation list if it's showing or was loaded.
- Channel and DM history: the existing status-keyed reload now merges (`resynced`) when it's reloading what's already shown, and resets when the channel/DM changed or when more than a page arrived meanwhile (`hasGap`). Stale edits in older loaded pages beyond the refetched page are accepted, as the packet allows.
- Voice occupancy is cleared on each connect's `ready` frame, so rooms that emptied while offline don't keep showing people; the fresh `voice_state` frames follow.
- Added beyond the packet's list, to meet "within 2s": the backoff can reach 15s, so the first sandbox run took 5.4s to reconnect after the network returned. `useSocket` now retries immediately on the browser's `online` event.
- Tests: the server and hook tests were written first and seen failing; the reducer and socket tests were written alongside.

## Not verified
- Real network loss (Wi-Fi off, sleep/wake). The sandbox simulated it by blocking new sockets in the page and dispatching `online` by hand.
- Resync while in the DM view: shares the channel logic and isn't separately exercised in the sandbox.

## Discovered Work
- If you're in a voice call when the connection drops, the server removes you from the room, and the client doesn't rejoin after reconnecting. Needs its own unit (rejoin, or tell the user the call ended).
- ~~DM sidebar "No conversations yet" (from P2-04)~~: fixed on `claude/fix-dm-list-from-notification` (the list now loads whenever the DM view opens).
