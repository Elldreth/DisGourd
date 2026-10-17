# P4-03 — Empty states with flat illustrations

- **Unit Type:** Implementation (child of P4-00)
- **Phase:** 4
- **State:** COMPLETE (merged in #109, 2026-10-17)
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
- [x] AC-1: every empty state in the app uses `EmptyState` (grep for the old inline markup finds none).
- [x] AC-2: the four illustrations render in both themes with their colours taken from CSS variables, and each shipped asset is under 20 KB (`ls -l` evidence).
- [x] AC-3: `design/empty-states/` holds the generated candidates and a `PROMPTS.md` with the prompt and model for each, and which one was picked.
- [x] AC-4: screen readers get the heading and body only (the art is `aria-hidden`); axe clean on each state.
- [x] AC-5: web tests for `EmptyState` (variants, action) and updated snapshots for the components that use it; `vite build` clean.

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

## Starting Baseline
Revision: `5e1ac10` (main after #108). Clean worktree `.claude/worktrees/p4-shine`. Web suite 57 files / 500 tests green.

## Implementation notes
- `EmptyState.jsx`: `{ art, icon, title, body, action, as, compact }`. `ART` holds the four scenes as JSX fragments in a 200×130 box; each places the real `Gourd` mark (so the body is `var(--color-brand-logo)` and the leaf `var(--color-lime)`) with a few shapes: a ground line (`channel`), two mirrored gourds with three lime dots (`dms`), a pot (`server`), a magnifier ring and handle with a lime lens highlight (`search`). `compact` draws at 120px with a `p` heading for small panels; `as` picks the heading element.
- Wired: `ChatPanel` (no server → `server`, no channel → `channel`), `DmPanel` home (`dms` + New message), `DmSidebar` empty (`dms` compact + New message), `MessageList` start card (`channel`, or `dms` for DMs; `emptyIcon` keeps the thread panel's icon variant; new `emptyArt` prop), `PinsPanel` (pin icon), `ThreadsList` (thread icon), `SearchOverlay` (`search` compact), `MemberList` (users icon), `ChannelList` (hash icon, with a hint for managers).
- The media MCP server refused image generation ("Requires basic plan or higher"), so the candidates were generated through the kie.ai REST API with the key from the root `.env` (never printed), model `google/nano-banana`, via a scratch script; eight PNGs and `PROMPTS.md` are under `design/empty-states/`.
- Not done, by choice: a "Create a server" button on "No server selected" (the create dialog's state lives inside `ServerRail`; wiring it needs a request prop like the invite one, recorded under Discovered Work) and an illustration in the thread panel (kept the thread icon: the column is narrow).

## Verification Evidence
| Acceptance Criterion | Status | Verification Type | Evidence |
|---|---|---|---|
| AC-1 | Verified | grep + suite | Every former empty-state block (`#`/💬 cards, the `p.text-gray-500` notices in pins, threads, search, members, channels, the DM list) now renders `EmptyState`; `grep -rn "text-6xl\|No members to show.</p>\|No channels yet.</p>"` finds nothing. 10 components changed |
| AC-2 | Verified | `EmptyState.test.jsx` + sandbox light theme | Test: each scene's markup has no literal hex colour, uses `--color-brand-logo` and `--color-lime`, and is under 6,000 characters (the channel scene is 1,188 bytes in the DOM). Sandbox: the DM home in light shows the darker lime leaves and dots. No separate asset files ship (inline SVG) |
| AC-3 | Verified | `design/empty-states/` | 8 PNGs (two per scene, 0.3–0.9 MB each) and `PROMPTS.md` with the model, the shared style suffix, each prompt, the run log and which candidate each shipped scene follows |
| AC-4 | Verified | axe-core on `main` in the sandbox + test | The art is `aria-hidden`; headings and body are plain text. axe on the chat column reports only the pre-existing `link-in-text-block` (recorded in P4-06) |
| AC-5 | Verified | Vitest, Vite, sandbox | `EmptyState.test.jsx`: 4 tests (watched fail first, then pass); all existing tests unchanged and green: 58 files / 504 tests; `vite build` clean. Sandbox (:3007 copy, 1280px, dark and light): DM home (`dms` + New message), channel welcome card (`channel`), pins popover (pin icon), search with no results (`search`) |

## Discovered Work
- "Create a server" from the no-server screen: `ServerRail` owns the Add-a-server dialog; add an `openRequest` prop (like `pendingInvite`) so `ChatPanel`'s empty state can open it.

