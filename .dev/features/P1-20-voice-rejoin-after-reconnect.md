# P1-20 — Rejoin your voice call after a reconnect

- **Unit Type:** Implementation
- **Phase:** 1 (reliability; found while doing P1-09)
- **State:** REVIEW (PR open)
- **Effort:** S–M
- **Depends on:** P1-09 (`ready` frame handling, `voice_state` on connect)
- **Requirement Source:** P1-09 Discovered Work; user request 2026-10-16 ("plan and do the voice-call rejoin after a reconnect")
- **Starting baseline:** main at 8045fe2 (after #65)

## Current state (investigated)
- When a gateway socket closes, the server runs `voiceLeave(ws)`: you're removed from the room, peers get `voice_peer_left` (they close their link to you) and the roster updates.
- The client's voice controller (`web/src/voice.js`) doesn't notice. After the socket reconnects it still shows you "connected" in the room, with dead peer links: silence both ways, and you're missing from everyone's roster.
- Signals queued while offline are harmless: the server relays `voice_signal` / `voice_mute` / `voice_share` only for a socket that's in a room, and a new socket isn't in one until it sends `voice_join`.
- `voice_join` always resets `muted` and `sharing` to false on the server, and answers the joiner with `voice_peers`. A refused join (channel deleted, now hidden, not a member) gets no reply.
- Half-open case: if the server hasn't noticed the old socket died yet, the rejoin replaces your room entry (the later close of the old socket is already ignored via the `entry.ws !== ws` check), but peers are told `voice_peer_joined` while still holding a stale link to you, which `newPeer` reuses.

## Scope
- Client (`voice.js`): `rejoin()`. If in a room and connected: close all peer links and drop remote audio/video, keep your own mic / shared audio / camera / screen streams (no new permission prompt), reset the chime baseline, send `voice_join`, then re-send `voice_mute` (if muted or deafened) and `voice_share` (if sharing). If no `voice_peers` reply arrives within 5s, leave the call and show why. Do nothing while idle or still `connecting` (that join's queued `voice_join` is sent on reconnect anyway).
- Client (`useVoiceCall.js`): call `rejoin()` on the `ready` frame (after clearing occupancy, as now).
- UI: while a rejoin is pending, the call shows as reconnecting; a failed rejoin shows a short notice ("Your call ended: couldn't rejoin #lounge.").
- Server (`gateway/voice.js`): on `voice_join` for a user already in that room on a *different* socket, tell the others `voice_peer_left` first, so they drop the stale link before `voice_peer_joined`.

## Scope changes during the work (required for the acceptance criteria)
Found by the two-tab sandbox test: after a rejoin the new peer link often never connected. Three causes in the existing negotiation code; all three are fixed here because the AC ("the peer link reconnects") can't pass without them:
1. **An offer right after an answer was dropped.** The impolite side, still applying the answer, saw the next offer as a collision and ignored it. Fixed with MDN's `answerPending` check.
2. **ICE candidates were lost.** Signals were applied concurrently, so a candidate could land before its offer was applied; the browser rejected it and the error was swallowed. Signals from each peer are now applied in order.
3. **Glare stalled ICE gathering in Chrome.** Both sides offered at once (joiner from `voice_peers`, existing members from `voice_peer_joined`); the polite side's rollback left that link gathering forever with zero candidates (captured in an event log). Now only the joiner offers; existing members create the link when the offer arrives. This affects every join, not just rejoins, and makes ordinary joins more reliable too.

## Non-goals
Keeping audio flowing through the drop (a server-side grace period that keeps you in the room). Multiple tabs in the same call.

## Acceptance criteria
- [x] Server test: joining a room you're already in from a new socket sends the others `voice_peer_left` then `voice_peer_joined`, and the roster lists you once.
- [x] Unit tests (controller with fake RTCPeerConnection): `rejoin()` closes old links, keeps the mic stream (getUserMedia called once), sends `voice_join` then `voice_mute` when muted; no-op when idle; leaves with a notice when no `voice_peers` arrives in time.
- [x] Sandbox: two users in a voice channel; drop one user's socket and restore it; both rosters show both users again and the peer link reconnects, without a new mic prompt.

## Expected Areas of Change
`web/src/voice.js`, `web/src/state/useVoiceCall.js`, the voice UI component that shows call status, `server/gateway/voice.js`, new tests.

## Working Set / Blast Radius
~5 files. Only affects people who are in a call when their connection drops.

## Evidence
| Check | Result |
|---|---|
| `server/tests/reconnect.test.js` (+1): rejoining from a new socket while the old lingers sends others `voice_peer_left` then `voice_peer_joined`; roster lists the user once; the old socket closing later doesn't remove them | pass (failed first) |
| `web/src/voice.test.js` (9, fake RTCPeerConnection + mic): rejoin closes old links, keeps the mic (getUserMedia once), sends `voice_join`, shows "Reconnecting…" until `voice_peers`; re-sends mute; no-op when idle; 5s with no reply ends the call with a notice; a reply cancels the timeout; joining clears the notice; offer-after-answer not dropped; candidate during offer not lost; existing members don't create a competing offer | pass (each new behaviour failed first) |
| Full suites | web 133/133, server 77/77, lint clean, build ok |
| Sandbox, two real browser tabs (sandy on localhost, bob on 127.0.0.1) in voice channel "hangout"; real `RTCPeerConnection`s, listen-only (the pane blocks microphones). Before the negotiation fixes the rejoined link stayed at "new": on the first try; in 2 of 3 rounds after fix 1; and still on the last round checked after fix 2. After: sandy's socket dropped 5 times, link back to "connected" each time in 588-752 ms (incl. ~500 ms socket retry); bob's dropped 3 times, 622-851 ms; both rosters show both users, one live link each | pass |
| Sandbox: sandy offline, the voice channel deleted meanwhile, network back: panel shows "Reconnecting…", after 5 s the call ends with "Your call ended: couldn't rejoin #hangout." in the sidebar; Dismiss removes it | pass |

## Not verified
- Real audio (the pane blocks microphones; links were listen-only, so media flow wasn't heard, only link state checked).
- Firefox / Safari; a real network loss (simulated by closing the socket / blocking new ones).
- The re-sent `voice_share` after rejoin (unit path mirrors mute; not exercised live).
- Camera / screen tracks being re-added after rejoin: `newPeer` adds existing streams, as on a normal join; not exercised live.
