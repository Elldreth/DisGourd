# P11-11 — Voice: TURN credentials from the server, relay-only option, honour forced mute

- **Unit Type:** Implementation (child of P11-00)
- **Phase:** 11
- **State:** COMPLETE (merged in #229; build order 13)
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
- [x] AC-1: `/voice/ice` without a token → 401. With `TURN_*` set it returns a TURN entry whose credential verifies against the secret, and the expiry is in the future.
- [x] AC-2: with `VOICE_RELAY_ONLY=1`, the peer connection is created with `iceTransportPolicy: 'relay'` (a Vitest test around `createVoiceController`).
- [x] AC-3: a force-muted peer's audio element is muted on the other clients, and unmuted when the timeout is lifted.
- [x] AC-4: with nothing set, behaviour is as today (STUN only).
- [~] AC-5: both suites pass. Manual: two sandbox users in a call through a local coturn, with only `relay` candidates in `webrtc-internals`.
- [~] AC-6: the sample coturn config denies every range listed above. With a local coturn, a TURN allocation that asks for a peer at 192.168.x.x or 100.64.x.x is refused (manual, written up).

## As built
- **`server/voice/ice.js` (new):** `iceFor(userId)` returns `{ iceServers, relayOnly, expiresAt }`.
  - **Cloudflare TURN** (owner decision 3), when `TURN_KEY_ID` is set: `POST https://rtc.live.cloudflare.com/v1/turn/keys/<id>/credentials/generate-ice-servers` with `Authorization: Bearer <TURN_KEY_TOKEN>` and `{ "ttl": 43200 }`, per Cloudflare's "Generate Credentials" page (last updated 2026-09-25, checked 2026-10-21).
    - Its `iceServers` (its STUN plus `turn:`/`turns:` with a username and credential) go to the browser as they are.
    - Each person's answer is reused for half its life (6 h), at most 1,000 people cached, with a 5 s timeout.
    - If Cloudflare fails: STUN only and `relayOnly: false`, so calls still work, plus an hourly-at-most `[voice] Cloudflare TURN credentials failed (…)` log.
  - **coturn**, with `TURN_URLS` + `TURN_SECRET`: the TURN REST scheme, username `<expiry>:<userId>` and credential `base64(HMAC-SHA1(secret, username))`, valid 12 h, after the STUN entry.
  - **Neither:** STUN only (`STUN_URLS` or Google's), `expiresAt: null`.
  - **`VOICE_RELAY_ONLY=1`** sets `relayOnly`, but only when a relay is in the answer; relay-only with no relay would break every call.
  - **Secrets:** `TURN_KEY_TOKEN_FILE` and `TURN_SECRET_FILE` through P11-14's `secretFromEnv`. `checkConfig()` at start makes an unreadable file stop the server, not someone's first call.
- **`server/routes/voice.js` (new):** `GET /voice/ice`, signed in, 60 per 10 min per person, `Cache-Control: no-store`. Registered in `routes/index.js`; `/voice` added to `web/devProxy.js`.
- **Forced mute (`server/gateway/voice.js`):**
  - Every room member has `forced`: set when they join timed out or are timed out in the call, cleared when the timeout is removed.
  - It's re-read from the database on their own `voice_mute`, so a timeout that ran out clears there too.
  - `voice_state`, `voice_peers` and `voice_peer_joined` carry it, and removing the timeout now broadcasts at once.
- **`web/src/voice.js`:**
  - `createVoiceController({ …, loadIce })` awaits `loadIce()` on join, reusing an answer until 5 minutes before it expires (5 minutes for a STUN-only answer). New links use `{ iceServers, iceTransportPolicy: 'relay' if relayOnly }`. A failure or empty answer means plain STUN.
  - Peers marked `forced` (not you) have every audio element muted, both mic and shared audio, until the mark clears. An ordinary mute isn't touched.
  - `window.__DISGOURD_ICE__` is gone. The CSP from P11-06 blocks the inline script the README suggested for it, and the server now provides the servers.
- **`useVoiceCall`** passes `loadIce: api.getVoiceIce`.
- **CSP:** no change.
  - `connect-src` governs fetch, XHR, WebSocket and EventSource, not ICE.
  - CSP Level 3's separate `webrtc` directive defaults to allow, and the policy doesn't set it.
  - `/voice/ice` is same-origin.
  - In the sandbox, a call with a `turn:` server and relay-only raised no violation.
- **Docs:**
  - README: the settings rows, "Voice behind TURN" (Cloudflare steps, its price, coturn with every `denied-peer-ip` range), the secrets-table row, and the SWAG note.
  - `deploy/unraid-tunnel/README.md` step 7 (TURN key, secret file 99:100 mode 400 mounted `:ro`, check, undo) and commented lines in its compose file.
  - `deploy/coturn/turnserver.conf.sample` (`use-auth-secret`, `no-multicast-peers`, TLS 1.2+, quotas, and `denied-peer-ip` for 0/8, 10/8, 100.64/10, 127/8, 169.254/16, 172.16/12, 192.168/16, ::1, fc00::/7, fe80::/10; comments on their own lines, since coturn has no trailing comments).

## Verification Evidence
| Acceptance Criterion | Status | Verification Type | Evidence |
|---|---|---|---|
| AC-1 | Verified | Jest `voice-ice.test.js` | No token → 401. coturn: the TURN entry's credential equals `HMAC-SHA1(secret, username)` (base64), the username names the user, and the expiry is ≥ 11 h ahead (and is `expiresAt`). Cloudflare, with a stubbed fetch: the request goes to the exact URL with `Bearer` from `TURN_KEY_TOKEN_FILE` and `{ ttl: 43200 }`, the answer is passed on, a second call is cached, and a 401 from Cloudflare falls back to STUN with one log line |
| AC-2 | Verified | Vitest `voice.test.js`; sandbox | `relayOnly: true` → `{ iceServers: [TURN], iceTransportPolicy: 'relay' }`; without it no policy; the answer is reused until near expiry, then fetched again. Sandbox with `TURN_URLS`/`TURN_SECRET`/`VOICE_RELAY_ONLY=1` (a temporary launch config, removed after): a wrapped `RTCPeerConnection` in the real app got `iceTransportPolicy: "relay"`, STUN plus `turn:127.0.0.1:3478` with a username and credential, and no CSP violations |
| AC-3 | Verified | Jest `timeouts.test.js`; Vitest | Server: a timed-out member is `forced: true` in `voice_state` (while in the call and on rejoining), and `false` as soon as the timeout is removed. Client: a forced peer's audio element is muted, and unmuted when the mark clears (an ordinary mute leaves it playing) |
| AC-4 | Verified | Jest; Vitest; sandbox | With nothing set, `/voice/ice` is `{ iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }], relayOnly: false, expiresAt: null }`, and with no loader the controller uses the same. Sandbox: the app asked `/voice/ice` on joining and built its link with that STUN entry and no policy |
| AC-5 | Partly | Jest, Vitest | Server 70 suites / 615 tests; web 110 files / 862 tests; `vite build` clean. `channel-topics.test.js` failed once under the parallel run and passed alone and on the rerun (it doesn't touch voice). **Not run:** a call through a real local coturn showing only `relay` candidates in `webrtc-internals`: this PC has no Docker and no coturn. For the live setup, the owner's check is in the Unraid recipe, step 7 |
| AC-6 | Partly | Jest `coturn-sample.test.js` | The sample's `denied-peer-ip` ranges cover 0.0.0.1, 10.x, 100.64.x and 100.100.100.100 (Tailscale), 127.0.0.1, 169.254.169.254, 172.16–31.x, 192.168.x, ::1, fc00::1, fd7a:115c:a1e0::1 and fe80::1, but not 8.8.8.8, 1.1.1.1, 172.32.0.1, 100.128.0.1 or 2606:4700::1111; plus `use-auth-secret` and `no-multicast-peers`. **Not run:** a real allocation refused by a live coturn (no Docker here) |

## Discovered Work (not done here)
- **A timeout that runs out by itself** clears `forced` only when that member next changes their mute, or rejoins. A small sweep, like the status sweep, could broadcast it.
- **Credentials refresh mid-call:** a call longer than 12 hours keeps its old TURN credentials; `setConfiguration()` could renew them. Unlikely in practice.

## Expected Areas of Change
A new `server/routes/voice.js` (registered in `routes/index.js`), `web/devProxy.js`, `web/src/voice.js`, `web/src/state/useVoiceCall.js`, `deploy/unraid-tunnel/README.md` (hosted TURN), a coturn sample for VPS installs (optional), the README, tests.

## Not in scope
An SFU (P11-00 Discovered Work).
