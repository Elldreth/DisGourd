# P3-13 — Voice stage: speaking ring on video tiles, pin/spotlight, fullscreen

- **Unit Type:** Implementation
- **Phase:** 3 — "Voice stage"
- **State:** REVIEW
- **Effort:** S–M
- **Depends on:** none
- **Serialize with:** voice.js units (none planned)
- **Requirement Source:** IMPROVEMENT-PLAN.md Phase 3. Revalidated: `voice.js` tracks a `speaking` Set and already exposes it on `participants`. The ChannelList avatars show a speaking ring. `VideoStage.jsx` tiles (43 lines) have no speaking state, no pin and no fullscreen. Tiles carry `userId`.

## Scope
- `voice.js` `buildVideoTiles()`: add `speaking: speaking.has(userId)` and `kind: 'camera' | 'screen'`. Self tiles know their kind. For remote tiles, infer `screen` from the track's `contentHint`/label or `getSettings().displaySurface` when available, and default to `camera`. Make sure `emit()` fires when speaking changes; it already does for participants.
- VideoStage:
  - a lime ring on the tiles of anyone speaking
  - clicking a tile (or its pin button) **spotlights** it: one large tile plus a strip of the rest; click again to unpin
  - a fullscreen button per tile using `requestFullscreen()` on the tile container
  - screen shares default to `object-contain`
  - Esc exits fullscreen natively
  - buttons are labelled (`aria-label`, `aria-pressed` for pin)
- There's no App.jsx change: VideoStage already receives `videos`.

## Acceptance criteria
- [x] Two clients with cameras on: speaking on A shows the ring on A's tile for B within about 300ms.
- [x] Pin a screen share: it fills the stage. Fullscreen works and Esc exits.
- [x] Unpinning restores the grid. A pinned tile that disappears (share stopped) unpins automatically.

## Expected Areas of Change
`web/src/components/VideoStage.jsx`, `web/src/voice.js` (only `buildVideoTiles`).

## Working Set / Blast Radius
2 files. Voice signalling is untouched.

## Evidence
Baseline: main at da6bb83 (after P3-03). Branch `claude/p3-13-voice-stage`.

Sandbox method: two real browser tabs in one WebRTC call (sandy on localhost:3005, bob on 127.0.0.1:3005), both in Tx Check #lounge. The Browser pane blocks devices, so each tab's `getUserMedia`/`getDisplayMedia` was swapped (test only, in the page) for a canvas video plus a noise source behind a gain, which is the "voice" turned up and down. Everything else (signalling, peer connections, speaking detection, rendering) was the real app.

| Acceptance criterion | Evidence |
|---|---|
| Speaking on A shows the ring on A's tile for B within ~300ms | `voice.test.js`: tiles carry `speaking`, which turns on and off with the analyser level. Sandbox: sandy's voice turned up at t=0, and bob's tab showed "sandy, speaking" with the lime ring **134 ms** later (MutationObserver timestamp). A screenshot shows the ring on the "A camera" tile, matching the sidebar avatar ring. |
| Pin a screen share: it fills the stage; fullscreen works and Esc exits | `VideoStage.test.jsx` covers pin/spotlight, click-to-pin, the full-screen button calling `requestFullscreen` on the tile, and "Exit full screen". Sandbox: a real click pinned "sandy (2)" (her share) and it filled the stage uncropped, with the other tiles in a row below. **Fullscreen not verified here:** a real click reaches `requestFullscreen()` on the tile, but the Browser pane holds the request and never settles it. To check in a normal browser. |
| Unpinning restores the grid; a pinned tile that disappears unpins | Tests for both, plus a test that pinning restyles the tile rather than remounting its `<video>`. Sandbox: the pin button toggled spotlight then grid. With the share pinned on bob's side, sandy stopped sharing: within 2.5s bob's stage was back to the grid with the share gone. Camera off removed the camera tile the same way. |

Web tests: 374 pass (9 new: 3 in voice.test.js, 6 in VideoStage.test.jsx). Build clean.

### Scope change (required for AC 3), recorded
Before this unit, a viewer's tile for a stopped camera or share **never went away**: the browser removes the track from the received stream, and voice.js only listened for the track's `ended` event, which doesn't fire for that. The sandbox showed a dead "sandy (2)" tile with zero tracks. `addRemoteVideo` now also drops the tile on the stream's `removetrack` once it has no video left. It's a small change in voice.js outside `buildVideoTiles`; signalling is untouched.

### Notes
- Remote screen shares usually can't be recognised as screens: a received track carries no `displaySurface` and nothing in signalling marks it. `kind` is 'screen' for your own share, or when the browser reports it. All tiles keep `object-contain`, so nothing is cropped either way.
- Because of that, a person with two videos gets numbered tiles ("sandy", "sandy (2)") so the pin and full-screen buttons are distinguishable.
- Tile controls (Pin with aria-pressed, Full screen) show on hover or keyboard focus, and always on touch screens. Each tile is a named group ("bob, speaking").
- Added `maximize`/`minimize` icons (Lucide).
