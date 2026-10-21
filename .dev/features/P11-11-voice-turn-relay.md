# P11-11 — Voice: TURN credentials from the server, relay-only option, honour forced mute

- **Unit Type:** Implementation (child of P11-00)
- **Phase:** 11
- **State:** ACTIVE (build order 13)
- **Starting baseline:** main at 89cf451 (#228 merged)
- **Owner decision 3 (2026-10-21):** Cloudflare TURN, with the key token in a secret file (`TURN_KEY_TOKEN_FILE`, via the P11-14 helper) next to `TURN_KEY_ID`; relay only when needed (`VOICE_RELAY_ONLY` off by default).
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
- **Which TURN, for the live setup:** the Cloudflare Tunnel carries HTTP only, and TURN needs UDP (3478 and a relay range). Self-hosting coturn on the Unraid box would mean router port forwards again, which undoes the "no open ports" setup. Recommended: a hosted TURN service with short-lived credentials (Cloudflare's TURN service, for example, mints them through an API with a key kept in the environment; check its current free allowance). The server code below works with either. `TURN_PROVIDER=cloudflare` + `TURN_KEY_ID` / `TURN_KEY_TOKEN` asks Cloudflare for credentials; `TURN_URLS` + `TURN_SECRET` is for coturn.
- **Docs:** README "Voice behind TURN": for self-hosting elsewhere (a VPS), a coturn container behind a compose profile, its ports (3478 UDP/TCP, 5349 TLS, a relay port range), `use-auth-secret`, `static-auth-secret`, `no-multicast-peers`, and `denied-peer-ip` for every private range: 10/8, 172.16/12, 192.168/16, 100.64/10 (CGNAT and Tailscale), 169.254/16, 127/8, 0/8, fc00::/7 (which covers Tailscale's fd7a:115c:a1e0::/48), fe80::/10 and ::1. Otherwise a client can ask TURN to relay into the cloud network, the tailnet or (on Unraid) the home LAN. That's TURN's own SSRF. Run coturn as its own container with its own network, and don't put it on the tailnet.

## Acceptance criteria
- [ ] AC-1: `/voice/ice` without a token → 401. With `TURN_*` set it returns a TURN entry whose credential verifies against the secret, and the expiry is in the future.
- [ ] AC-2: with `VOICE_RELAY_ONLY=1`, the peer connection is created with `iceTransportPolicy: 'relay'` (a Vitest test around `createVoiceController`).
- [ ] AC-3: a force-muted peer's audio element is muted on the other clients, and unmuted when the timeout is lifted.
- [ ] AC-4: with nothing set, behaviour is as today (STUN only).
- [ ] AC-5: both suites pass. Manual: two sandbox users in a call through a local coturn, with only `relay` candidates in `webrtc-internals`.
- [ ] AC-6: the sample coturn config denies every range listed above. With a local coturn, a TURN allocation that asks for a peer at 192.168.x.x or 100.64.x.x is refused (manual, written up).

## Expected Areas of Change
A new `server/routes/voice.js` (registered in `routes/index.js`), `web/devProxy.js`, `web/src/voice.js`, `web/src/state/useVoiceCall.js`, `deploy/unraid-tunnel/README.md` (hosted TURN), a coturn sample for VPS installs (optional), the README, tests.

## Not in scope
An SFU (P11-00 Discovered Work).
