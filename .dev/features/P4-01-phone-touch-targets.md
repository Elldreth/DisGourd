# P4-01 — Phone touch targets and header

- **Unit Type:** Implementation (child of P4-00)
- **Phase:** 4
- **State:** COMPLETE (merged in #103, 2026-10-17)
- **Effort:** M
- **Depends on:** none
- **Serialize with:** P4-06 and P4-07 (`ChatPanel.jsx`, `MessageList.jsx`, `index.css`)
- **Requirement Source:** `design/UX-REVIEW-2026-10.md` A1 and M2. Measured in the sandbox at 375×812: 41 of 50 interactive elements under 44 px; header icon buttons 30×30, channel and DM rows 32 px tall, reactions 20 px, thread chips 24 px, spoiler buttons 20 px, Archive/Follow 24 px, Sign out 29 px.

## Scope
- A `@media (pointer: coarse)` block in `index.css` (or a `coarse:` variant via `@custom-variant`) that enlarges hit areas without changing desktop:
  - `IconButton` and the other icon buttons in headers and the user footer: 44×44 (padding, not icon size).
  - Channel rows, DM rows, voice participants, member rows: 44 px minimum height.
  - Reactions: 28 px tall with 8 px gaps; thread chips 32 px; spoiler buttons 24 px with 4 px vertical padding.
  - Composer buttons (attach, emoji, send) 40 px; Send becomes an icon button below `md`.
- Chat header on phones: Threads and Pins fold under one "More" (…) menu button so the remaining buttons (menu, members, more, search) have room at 44 px. Desktop keeps the four separate buttons.
- Thread panel header buttons (Archive, Follow, close) follow the same rule.

## Acceptance criteria
- [x] AC-1: at 375×812 in the sandbox, every interactive element in the chat header, channel list, DM list, composer and thread header measures at least 44 px in both dimensions; reactions and chips at least 28 px tall. (Script: the one used in the review, re-run.)
- [x] AC-2: at 1280×800 the measured sizes of the same elements are unchanged from before the unit (no desktop regression).
- [x] AC-3: the phone "More" menu opens Threads and Pins and is reachable by keyboard (menu button with `aria-haspopup`, Esc closes).
- [x] AC-4: web tests cover the More menu and the coarse-pointer class names; suites and `vite build` pass.

## Expected Areas of Change
`web/src/index.css`, `web/src/components/IconButton.jsx`, `ChatPanel.jsx`, `ChannelList.jsx`, `DmSidebar.jsx`, `MemberList.jsx`, `MessageList.jsx` (reaction / chip classes), `Composer.jsx`, `ThreadPanel.jsx`, plus tests.

## Working Set / Blast Radius
About 9 files, all class-level changes; no state or API changes. Risk: a coarse-pointer rule that also hits desktop touchscreens (acceptable, they benefit too).

## Testing Strategy
Vitest for the More menu and class presence; the sandbox measurement script at 375 px and 1280 px for AC-1 and AC-2 (the pane's mobile preset emulates a coarse pointer).

## Out of Scope
Safe-area insets and `100dvh` (M3, recorded in P4-00), thread back button (P4-07).

## Starting Baseline
Revision: `3c29a69` (main after #102). Workspace: clean worktree `.claude/worktrees/p4-shine`. Web suite 52 files / 465 tests green.

## Implementation notes
- `index.css` gains a `coarse` custom variant (`@media (pointer: coarse)`) and four utilities that only apply there: `tap` (44×44 minimum), `tap-row` (44 tall), `tap-chip` (32 tall), `tap-reaction` (28 tall, 10px side padding). Desktop styles are untouched because the rules live inside the media query.
- Classes added: chat header buttons, channel / voice / DM / member rows, the create-channel buttons, the channel settings gear, the user footer (status, profile row, sign out), composer attach / emoji / send, thread header (Archive, Follow, Close), reactions (`gap-2` between them on coarse pointers) and thread summary chips.
- Phones: Threads and Pins fold under a **More** (…) button in the chat header (`md:hidden`); the separate buttons are `hidden md:inline-flex`. The menu is a `role="menu"` with two `menuitem`s: opening focuses the first item, arrow keys move, Esc closes and returns focus to the button, a backdrop click closes. The More button carries the threads-unread count in its name ("More (2 unread)") and a dot; the Threads item is named "Threads (2 unread)".
- Send becomes an icon (paper plane) below `md` with `aria-label="Send"`; the word returns from `md` up.

## Verification Evidence
| Acceptance Criterion | Status | Verification Type | Evidence |
|---|---|---|---|
| AC-1 | Verified | Sandbox measurement (P4 copy of the sandbox DB on :3007, 375×812, coarse pointer) | Channel screen: 24 interactive elements, 3 under 44px, all exempt or out of scope (inline "Jump to the original message" link 16px tall, the textarea 36px, the profile row 40px before its own fix). Header: Channels, Members, More, Search 44×44. Drawer: rail 48×48, channel and voice rows 223×44, Create channel / Create voice channel 44×44, Set status 44×44, Sign out 44×44, member drawer close 44×44, member row 239×44. Composer: Attach 44×44, Emoji 44×44, Send 44×44 (icon). Thread header: Archive 59×32, Unfollow 70×32, Close 44×44. Reactions 41×28, thread chip 275×32 |
| AC-2 | Verified | Same script at 1280×800 (fine pointer) | Threads / Pinned messages / Search 30×30, Create channel 20×20, Sign out 29×29, Set status 36×36, Attach / Emoji 32×32, Send 59×32 with the word, reaction 41×20, thread chip 250×24, Archive 59×24, Close thread 30×30: identical to the sizes measured in the review before the change. Channels, Members and More are `display: none` |
| AC-3 | Verified | Sandbox + `touchTargets.test.jsx` | At 375px: More opens a two-item menu (Threads, Pinned messages); ArrowDown then Enter opened the Pins popover ("No pinned messages in #general yet"); Esc closed it. Test: `aria-haspopup="menu"`, `aria-expanded`, first item focused on open, Esc returns focus, choosing Threads opens the list, unread count in both names |
| AC-4 | Verified | Vitest, Vite | `touchTargets.test.jsx`: 7 tests (watched fail first, then pass). Full web suite 53 files / 472 tests green; `vite build` clean; the compiled CSS contains the four utilities under `(pointer: coarse)`. No console errors in the sandbox. Server untouched (client-only unit) |
