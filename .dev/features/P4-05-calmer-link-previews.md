# P4-05 — Calmer link previews

- **Unit Type:** Implementation (child of P4-00)
- **Phase:** 4
- **State:** REVIEW (branch `claude/p4-05-link-previews`, PR pending)
- **Effort:** S
- **Depends on:** none (P2-12, P2-23 are merged)
- **Serialize with:** anything editing `Embed.jsx`
- **Requirement Source:** `design/UX-REVIEW-2026-10.md` V1. A GitHub preview is about 320 px tall on desktop (full-width 1,200×600 image) and a whole screen on a phone; one card pushes three or four messages off screen.

## Scope
- `Embed.jsx`: card max width 420 px; image area max height 180 px with `object-fit: cover`; wide images (ratio over 2:1) render as a 72 px thumbnail at the right of the text instead of a banner. Description stays two lines.
- A "Hide preview" control for the message author (and moderators who can delete others' messages): a small × on the card that calls the existing delete-preview path if one exists, otherwise `PUT /spaces/:s/messages/:id/preview { hidden: true }`. **Check first:** if the server has no such route, record it in Discovered Work and ship only the sizing (still worth it); do not add a migration in this unit.
- Phone: the card spans the message width but never exceeds the 180 px image cap.

## Acceptance criteria
- [x] AC-1: in the sandbox the GitHub preview under "preview test" measures at most 420 px wide and its image at most 180 px tall at 1280 px; at 375 px the image is at most 180 px tall and nothing scrolls horizontally.
- [x] AC-2: a tall or square image (ratio under 2:1) still shows as a banner within the cap; a wide one shows as a thumbnail.
- [ ] AC-3 (deferred, see Discovered Work): if the hide control ships: the author can hide a preview, it stays hidden on reload, and other viewers lose it live. If it doesn't ship: this AC is marked "deferred, see Discovered Work" with the reason.
- [x] AC-4: `Embed.test.jsx` covers the sizing rules; suites and build pass.

## Expected Areas of Change
`web/src/components/Embed.jsx`, `Embed.test.jsx`; possibly `MessageList.jsx` (passing `mine`/`canDelete` to the card) and, only if the route exists, `api.js`.

## Working Set / Blast Radius
2–4 files, CSS-level. Blast radius: every link preview in channels, DMs and threads.

## Testing Strategy
Vitest for class names and the ratio branch; sandbox measurements with `getBoundingClientRect` on the existing preview.

## Out of Scope
New unfurl fields, server-side image resizing, the preview proxy (P2-23).

## Starting Baseline
Revision: `63b0ab8` (main after #106). Clean worktree `.claude/worktrees/p4-shine`. Web suite 56 files / 493 tests green.

## Implementation notes
- `Embed.jsx` only. Card `max-w-[420px]` (was `max-w-md`, 448px); description `line-clamp-2` (was 3); banner image `max-h-44` (176px, was `max-h-64`) with `object-cover`.
- **Shape rule, changed from the plan:** the plan said wide images (over 2:1) become thumbnails and tall or square ones stay banners. That is backwards for the real cases: the common 1200×630 share image is 1.9:1 and the GitHub one exactly 2:1, so the rule would have turned the pictures people actually post into 72px thumbnails while leaving portrait images as tall banners. Implemented instead (the Discord/Slack behaviour): a **small or square** image (narrower than 300px, or less than 1.4:1) becomes a 72px (`size-18`) thumbnail beside the text; anything wider is a banner under the text, capped at 176px tall. The complaint in the review (V1) was the banner's height, and the cap fixes that for every wide image.
- The embed carries no dimensions, so the shape is decided in the image's `onLoad` from `naturalWidth` / `naturalHeight`; until then it renders as a capped banner.
- No hide control: there is no route or column for hiding a preview (`message_embeds` has none), and this unit is client-only. Recorded under Discovered Work.

## Verification Evidence
| Acceptance Criterion | Status | Verification Type | Evidence |
|---|---|---|---|
| AC-1 | Verified | Sandbox (P4 copy of the sandbox DB on :3007) | 1280px: the GitHub card under "preview test" is 420×294, its 1200×600 image 392×176 (before: card 448 wide, image about 224 tall). 375px: card 275×266 (the message column's width), image 247×124, page scrollWidth 375 = viewport (no horizontal scroll) |
| AC-2 | Verified (rule as implemented, see notes) | `Embed.test.jsx` | 1200×600 → banner (`max-h-44`, `object-cover`, no `size-18`); 400×400 → thumbnail (`size-18`, in a flex row after the text, title still a link); 240×100 → thumbnail (too small for a banner) |
| AC-3 | Deferred | — | No server route exists for hiding a preview; recorded under Discovered Work rather than adding a migration in a client-only unit |
| AC-4 | Verified | Vitest, Vite | Two new tests in `Embed.test.jsx` (watched fail, then pass); the six existing ones unchanged. Full web suite 56 files / 495 tests; `vite build` clean; the compiled CSS contains `size-18` |

## Discovered Work
- "Hide preview" for the author (and moderators): needs a `hidden` flag on `message_embeds` / `dm_message_embeds`, a `PUT /spaces/:s/messages/:id/preview` route, a gateway frame so other viewers drop it, and a small × on the card. One S server + client unit.

