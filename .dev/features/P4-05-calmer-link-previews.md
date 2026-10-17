# P4-05 — Calmer link previews

- **Unit Type:** Implementation (child of P4-00)
- **Phase:** 4
- **State:** READY
- **Effort:** S
- **Depends on:** none (P2-12, P2-23 are merged)
- **Serialize with:** anything editing `Embed.jsx`
- **Requirement Source:** `design/UX-REVIEW-2026-10.md` V1. A GitHub preview is about 320 px tall on desktop (full-width 1,200×600 image) and a whole screen on a phone; one card pushes three or four messages off screen.

## Scope
- `Embed.jsx`: card max width 420 px; image area max height 180 px with `object-fit: cover`; wide images (ratio over 2:1) render as a 72 px thumbnail at the right of the text instead of a banner. Description stays two lines.
- A "Hide preview" control for the message author (and moderators who can delete others' messages): a small × on the card that calls the existing delete-preview path if one exists, otherwise `PUT /spaces/:s/messages/:id/preview { hidden: true }`. **Check first:** if the server has no such route, record it in Discovered Work and ship only the sizing (still worth it); do not add a migration in this unit.
- Phone: the card spans the message width but never exceeds the 180 px image cap.

## Acceptance criteria
- [ ] AC-1: in the sandbox the GitHub preview under "preview test" measures at most 420 px wide and its image at most 180 px tall at 1280 px; at 375 px the image is at most 180 px tall and nothing scrolls horizontally.
- [ ] AC-2: a tall or square image (ratio under 2:1) still shows as a banner within the cap; a wide one shows as a thumbnail.
- [ ] AC-3: if the hide control ships: the author can hide a preview, it stays hidden on reload, and other viewers lose it live. If it doesn't ship: this AC is marked "deferred, see Discovered Work" with the reason.
- [ ] AC-4: `Embed.test.jsx` covers the sizing rules; suites and build pass.

## Expected Areas of Change
`web/src/components/Embed.jsx`, `Embed.test.jsx`; possibly `MessageList.jsx` (passing `mine`/`canDelete` to the card) and, only if the route exists, `api.js`.

## Working Set / Blast Radius
2–4 files, CSS-level. Blast radius: every link preview in channels, DMs and threads.

## Testing Strategy
Vitest for class names and the ratio branch; sandbox measurements with `getBoundingClientRect` on the existing preview.

## Out of Scope
New unfurl fields, server-side image resizing, the preview proxy (P2-23).

## Verification Evidence
| Acceptance Criterion | Status | Verification Type | Evidence |
|---|---|---|---|
| AC-1 | Not verified | | |
| AC-2 | Not verified | | |
| AC-3 | Not verified | | |
| AC-4 | Not verified | | |
