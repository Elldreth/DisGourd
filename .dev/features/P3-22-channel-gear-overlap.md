# P3-22 — The channel gear no longer covers the 18+ tag

- **Unit Type:** Implementation
- **Phase:** 3
- **State:** REVIEW
- **Effort:** XS
- **Depends on:** P2-20d (18+ tag). Branched from P3-21 (#132) only to keep INDEX.md conflict-free; merge after it.
- **Requirement Source:** the user, 2026-10-18: with an 18+ channel selected, the channel-settings gear sits over the 18+ tag, hiding it.

## Scope
- In `ChannelList`, a manager's text-channel row gets right padding whenever the gear shows (on hover, on focus, or while its dialog is open). The 18+ tag, the private/read-only shield and the unread badges move left of the gear, and the name truncates instead. The padding is 32 px, or 52 px on touch screens, where the gear is 44 px.

## Acceptance criteria
- [x] Web test: a manager's row carries the hover/focus padding, and keeps it while its settings dialog is open.
- [x] All web tests pass; `vite build` is clean.
- [x] Sandbox: with the gear showing on an 18+ channel, the tag and the gear don't overlap.

## Evidence (2026-10-18)
| Acceptance criterion | Evidence |
|---|---|
| Web | `ImagineSwitches.test.jsx`, "channel list: an 18+ tag…": the after-dark row has `group-hover:pr-8`; after "Channel settings for after-dark" is clicked, it has `pr-8` |
| Suites | Web: 73 files, 608 tests. `vite build` clean |
| Sandbox | sandy, Tx Check #random (18+), row focused, gear shown (`display: flex`): row padding-right 32px, tag right edge 271px, gear left edge 276px, so no overlap (before the fix the tag ran to 295px, under the gear) |
