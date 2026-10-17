# P4-03 — Empty states with flat illustrations

- **Unit Type:** Implementation (child of P4-00)
- **Phase:** 4
- **State:** READY
- **Effort:** M
- **Depends on:** none (P4-04 benefits from it)
- **Serialize with:** P4-04 (`DmSidebar.jsx`, `DmPanel.jsx`), P4-06/P4-07 (`ThreadPanel.jsx`)
- **Requirement Source:** `design/UX-REVIEW-2026-10.md` V3. Six empty states with six treatments (a `#` glyph, a 💬 emoji, the gourd mark, plain grey text); IMPROVEMENT-PLAN.md Phase 4 already asked for "empty-state illustrations: no servers, empty channel, no DMs".

## Scope
- `web/src/components/EmptyState.jsx`: `{ art, title, body, action }`. `art` is one of a small set of inline SVG spot illustrations (or an icon name for the plain variant). Centred, max 280 px wide, text at most 44 characters per line, optional action button.
- Four illustrations, flat, two colours (violet body + lime accent, both from theme tokens so they follow the light theme): **empty channel** (a gourd lantern with a speech bubble, unlit), **no DMs** (two gourds facing each other), **no server** (a single gourd on a shelf / in a pot), **nothing found** (a gourd with a magnifier). Reused by: channel welcome card, DM home, DM conversation start, No server selected, pins, threads, search, members.
- Assets: generate candidates with kie.ai (`generate_image`), store the picked ones with their prompts under `design/empty-states/` (PNG), then redraw each as a clean inline SVG under 6 KB (the generated PNGs are references, not shipped). If an SVG redraw is not faithful enough, ship a WebP under 20 KB from `web/public/empty/`.
- Copy stays as it is (it is already friendly), except: "No server selected" gains a "Create a server" button; "No conversations yet" gains "New message" (wired by P4-04, until then it opens the quick switcher).

## Acceptance criteria
- [ ] AC-1: every empty state in the app uses `EmptyState` (grep for the old inline markup finds none).
- [ ] AC-2: the four illustrations render in both themes with their colours taken from CSS variables, and each shipped asset is under 20 KB (`ls -l` evidence).
- [ ] AC-3: `design/empty-states/` holds the generated candidates and a `PROMPTS.md` with the prompt and model for each, and which one was picked.
- [ ] AC-4: screen readers get the heading and body only (the art is `aria-hidden`); axe clean on each state.
- [ ] AC-5: web tests for `EmptyState` (variants, action) and updated snapshots for the components that use it; `vite build` clean.

## Expected Areas of Change
`EmptyState.jsx` (new), `ChatPanel.jsx`, `MessageList.jsx` (welcome card), `DmPanel.jsx`, `DmSidebar.jsx`, `App.jsx` (DM home), `PinsPanel.jsx`, `ThreadsList.jsx`, `ThreadPanel.jsx`, `SearchOverlay.jsx`, `MemberList.jsx`, `design/empty-states/*`, tests.

## Working Set / Blast Radius
About 11 files but each change is a few lines; the new component is the only logic. Blast radius: visual only.

## Testing Strategy
Vitest for the component; a sandbox pass through each empty state at 1280 px and 375 px, dark and light, with screenshots in the packet evidence.

## Non-Functional Considerations
Accessibility: art hidden from AT; headings stay `h2`/`h3` consistent with the surrounding panel. Performance: inline SVG, no network fetch.

## Out of Scope
Mascot poses, stickers, login hero art, the sound set (Phase 4 items that are not empty states).

## Verification Evidence
| Acceptance Criterion | Status | Verification Type | Evidence |
|---|---|---|---|
| AC-1 | Not verified | | |
| AC-2 | Not verified | | |
| AC-3 | Not verified | | |
| AC-4 | Not verified | | |
| AC-5 | Not verified | | |
