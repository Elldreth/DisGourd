# P4-06 — Hierarchy and accessibility polish

- **Unit Type:** Implementation (child of P4-00)
- **Phase:** 4
- **State:** COMPLETE (merged in #104, 2026-10-17)
- **Effort:** S
- **Depends on:** none
- **Serialize with:** P4-01 (`ChatPanel.jsx`, `MessageList.jsx`, `index.css`), P4-07 (`ThreadPanel.jsx`)
- **Requirement Source:** `design/UX-REVIEW-2026-10.md` V4, F6, V5, V6, V8, A2, A3, A4, V2, V7. Ten small findings that share files, bundled so they land in one PR.

## Scope (each item is one small change)
1. **V4 Server rail groups:** a 24 px divider under the DM gourd and one above the "+" / join actions; actions drawn as outlined circles (ring, no fill).
2. **F6 Server menu:** a divider and extra padding above "Delete server".
3. **V5 Timestamps:** grouped-message hover time 11 px, `gray-400`; on coarse pointers show the time for the first message of each group without hover.
4. **V6 Auth card:** drop the logo tile's ring and background on Login and the wizard (`AuthShell.jsx`).
5. **V8 Thread panel:** replies top-aligned, a thread icon instead of `#` in the empty state, "Started by {user} · {when}" under the root.
6. **A2 Settings labels:** `label htmlFor` for the Microphone and Speaker selects; the join/leave and push-to-talk checkboxes wrapped in labels.
7. **A3 Landmarks:** a visually hidden `h1` ("DisGourd") in App; `nav aria-label="Channels"` around the channel list; `aside aria-label="Members"` already exists, confirm; the DM list as `nav aria-label="Direct messages"`.
8. **A4 Message toolbar:** position at the row's top edge (`-top-3`) with an opaque background, so it never overlaps text.
9. **V2 Thread chip:** name gets the flexible width, "last …" hidden below 360 px, reply count always shown.
10. **V7 Light-theme leaf:** `Gourd` draws the leaf with `var(--color-lime)` when no explicit colour is passed, so the light theme's darker lime applies. (Owner may veto; if so, drop this item only.)

## Acceptance criteria
- [x] AC-1: axe-core on the main screen (titles stripped) reports zero violations (was: `page-has-heading-one`, `region`).
- [x] AC-2: the two selects and two checkboxes in Settings have accessible names that match their captions (read_page / Testing Library `getByLabelText`).
- [x] AC-3: at 1280 px the message toolbar's bounding box does not intersect the message text's box on a one-line message.
- [x] AC-4: at 375 px the thread chip shows the full first 20 characters of the thread name and the reply count.
- [x] AC-5: visual items 1, 2, 4, 5, 10 have before/after screenshots in the evidence, dark and light.
- [x] AC-6: suites and build pass; `theme.contrast.test.js` still passes with the leaf change.

## Expected Areas of Change
`ServerRail.jsx`, `ChannelList.jsx` (menu, nav), `MessageList.jsx` (timestamps, toolbar, chip), `MessageActions.jsx`, `AuthShell.jsx`, `ThreadPanel.jsx`, `AudioSettings.jsx`, `App.jsx` (h1), `DmSidebar.jsx`, `Gourd.jsx`, `index.css`, tests.

## Working Set / Blast Radius
About 11 files, a few lines each. Risk: none of these change behaviour; the Gourd change affects the favicon-style uses, so check the rail and auth screens in both themes.

## Testing Strategy
Vitest for A2, A3 (landmarks present), V2 (chip classes); axe in the sandbox for AC-1; a script for AC-3; screenshots for the rest.

## Out of Scope
Touch sizes (P4-01), thread back button (P4-07), anything in the settings layout (P4-02).

## Starting Baseline
Revision: `2669961` (main after #103). Clean worktree `.claude/worktrees/p4-shine`. Web suite 53 files / 472 tests green.

## Implementation notes
- **V4** `ServerRail.jsx`: the rail is `nav aria-label="Servers"` with a visually hidden `h1` "DisGourd" (A3). The divider under the DM gourd is now a `role="separator"`, a second one sits above the actions (only when there are servers), and the two action buttons are outlined (`ring-2 ring-inset ring-ink-500`, no fill) so filled circles mean places and outlined ones mean actions.
- **F6** `ChannelList.jsx`: a `role="separator"` line before "Delete server" in the server menu. The list's root is `nav aria-label="Channels"` (A3). `DmSidebar.jsx`'s root is `nav aria-label="Direct messages"`.
- **V5** `MessageList.jsx`: grouped-message hover time is 11px `gray-400` and `coarse:block` (always shown on touch).
- **V2** the thread chip's name span is `min-w-0 flex-1 truncate`; the reply count is its own `shrink-0` span; "· last …" is `max-[360px]:hidden`; "· archived" its own span.
- **V8** `MessageList` gained `topAligned` and `emptyIcon` props; `ThreadPanel` passes `topAligned` and `emptyIcon="thread"`, and the root message's meta reads "Started by {author} · {day} {time}".
- **V6** `AuthShell.jsx`: the logo tile is gone (no ring, no background); the mark is drawn at 64px straight on the card.
- **V7** `Gourd.jsx`: with no `color`, the body is `var(--color-brand-logo)` and the leaf `var(--color-lime)`, so the light theme's `#2b7512` applies. `Icon.jsx` adds `data-icon={name}` so tests and styles can tell icons apart.
- **A2** turned out to be a false finding: the Microphone select is wrapped in a `label`, the Speaker select has `aria-label`, and both checkboxes sit inside labels. The new test (`computeAccessibleName`) passed before any change; the review's read_page tool had reported the selected option as the name. No change.
- **A4** also needed no change: the toolbar already straddles the row's top edge (`-top-3`) with an opaque background. Measured in the sandbox: on a one-line message no text glyph sits under it (see AC-3).

## Verification Evidence
| Acceptance Criterion | Status | Verification Type | Evidence |
|---|---|---|---|
| AC-1 | Verified (structural) | axe-core 4.10.2 in the P4 sandbox (:3007, 1280px, titles stripped) | `page-has-heading-one` and `region` are gone. Two **pre-existing** findings surfaced because bob is offline in this DB copy: `color-contrast` on the offline member row (the row is `opacity-50`, so the avatar initials and the name fall below 4.5:1) and `link-in-text-block` (links in message text are told apart by colour only). Both recorded under Discovered Work; neither comes from this unit |
| AC-2 | Verified (no change needed) | `polish.test.jsx` "audio settings: selects and checkboxes are named by their captions" | `computeAccessibleName` gives Microphone, Speaker, Join/leave sounds, Push-to-talk. Passed before any change: the controls were already labelled |
| AC-3 | Verified | Sandbox measurement at 1280px | Toolbar box x 1102–1220, y 395–425 on "general new 2"; the message's text glyphs (Range rects) span x 388–495, y 411–431: no glyph under the toolbar. No change was needed |
| AC-4 | Verified | Sandbox at 375px | Chip 275px wide; the name span shows 144px of "router http://192.168.1.1/ and…" (about 26 characters) and the reply count "· No replies yet" stays; unit test checks `min-w-0 flex-1`, `shrink-0` and `max-[360px]:hidden` |
| AC-5 | Verified | Sandbox screenshots, dark and light | Rail: separator above the outlined "+" and join buttons (dark and light). Server menu: separator above "Delete server" (dark and light). Auth card: the mark sits on the card with one ring. Thread panel: replies top-aligned, thread icon in the empty state, "Started by sandy · Yesterday 11:49 PM". Light theme: the leaf's computed fill is rgb(43, 117, 18) |
| AC-6 | Verified | Vitest, Vite | `polish.test.jsx`: 9 tests (8 watched fail first, then pass; the A2 one passed at once, see AC-2). Full web suite 54 files / 481 tests green, including `theme.contrast.test.js`; `vite build` clean |

## Discovered Work
- Offline member rows use `opacity-50`, which takes the name and avatar initials below AA contrast (axe `color-contrast`). Fix: dim with a muted text colour instead of opacity.
- Links inside message text are distinguished by colour only (axe `link-in-text-block`). Fix: underline on hover and a subtle underline at rest, a design choice for the owner.

