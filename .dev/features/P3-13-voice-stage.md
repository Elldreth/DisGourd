# P3-13 — Voice stage: speaking ring on video tiles, pin/spotlight, fullscreen

- **Unit Type:** Implementation
- **Phase:** 3 — "Voice stage"
- **State:** READY
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
- [ ] Two clients with cameras on: speaking on A shows the ring on A's tile for B within about 300ms.
- [ ] Pin a screen share: it fills the stage. Fullscreen works and Esc exits.
- [ ] Unpinning restores the grid. A pinned tile that disappears (share stopped) unpins automatically.

## Expected Areas of Change
`web/src/components/VideoStage.jsx`, `web/src/voice.js` (only `buildVideoTiles`).

## Working Set / Blast Radius
2 files. Voice signalling is untouched.
