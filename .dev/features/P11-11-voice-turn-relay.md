# P11-11 — Voice: TURN credentials from the server, relay-only option, honour forced mute

- **Unit Type:** Implementation (child of P11-00)
- **Phase:** 11
- **State:** READY (the code); running coturn depends on owner decision 3 in P11-00
- **Effort:** M
- **Depends on:** none
- **Serialize with:** none
- **Requirement Source:** P11-00 finding M8.

## Problem
- Voice is a STUN-only mesh (`web/src/voice.js:20-23`). Everyone in a call learns everyone else's public IP address from the ICE candidates.
- Calls also fail between people behind strict NATs, because there's no TURN.
- A timed-out member is muted only in the room state (`server/gateway/voice.js:88,124`). A modified client can keep sending audio.

## Scope
- **Server:**
  - `GET /voice/ice` (signed in) returns `{ iceServers, relayOnly }`.
  - With `TURN_URLS` (comma-separated `turn:` / `turns:` URLs) and `TURN_SECRET` set, it mints coturn REST credentials: username `<expiry>:<userId>`, credential `HMAC-SHA1(secret, username)`, valid for 12 hours.
  - `STUN_URLS` overrides the default STUN, and `VOICE_RELAY_ONLY=1` sets `relayOnly`.
  - Add the route to `web/devProxy.js`.
- **Client:** fetch `/voice/ice` when joining a call (cached until it expires). Use `iceTransportPolicy: 'relay'` when `relayOnly`. Fall back to today's STUN when the request fails.
- **Forced mute:** when a peer is marked force-muted in `voice_state`, honest clients stop playing that peer's audio track (they mute the `<audio>` element) until the mark clears. Unlike today, a modified client can't be heard by anyone running the real app.
- **Docs:** README "Voice behind TURN": a coturn container in the cloud compose (P11-05's `deploy/cloud/`, behind a profile), its ports (3478 UDP/TCP, 5349 TLS, a relay port range), `use-auth-secret`, `static-auth-secret`, `no-multicast-peers`, and `denied-peer-ip` for the private ranges (so TURN can't be used to reach the cloud network: that's TURN's own SSRF).

## Acceptance criteria
- [ ] AC-1: `/voice/ice` without a token → 401. With `TURN_*` set it returns a TURN entry whose credential verifies against the secret, and the expiry is in the future.
- [ ] AC-2: with `VOICE_RELAY_ONLY=1`, the peer connection is created with `iceTransportPolicy: 'relay'` (a Vitest test around `createVoiceController`).
- [ ] AC-3: a force-muted peer's audio element is muted on the other clients, and unmuted when the timeout is lifted.
- [ ] AC-4: with nothing set, behaviour is as today (STUN only).
- [ ] AC-5: both suites pass. Manual: two sandbox users in a call through a local coturn, with only `relay` candidates in `webrtc-internals`.

## Expected Areas of Change
A new `server/routes/voice.js` (registered in `routes/index.js`), `web/devProxy.js`, `web/src/voice.js`, `web/src/state/useVoiceCall.js`, `deploy/cloud/` (coturn, optional), the README, tests.

## Not in scope
An SFU (P11-00 Discovered Work).
