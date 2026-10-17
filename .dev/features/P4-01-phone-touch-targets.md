# P4-01 — Phone touch targets and header

- **Unit Type:** Implementation (child of P4-00)
- **Phase:** 4
- **State:** READY
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
- [ ] AC-1: at 375×812 in the sandbox, every interactive element in the chat header, channel list, DM list, composer and thread header measures at least 44 px in both dimensions; reactions and chips at least 28 px tall. (Script: the one used in the review, re-run.)
- [ ] AC-2: at 1280×800 the measured sizes of the same elements are unchanged from before the unit (no desktop regression).
- [ ] AC-3: the phone "More" menu opens Threads and Pins and is reachable by keyboard (menu button with `aria-haspopup`, Esc closes).
- [ ] AC-4: web tests cover the More menu and the coarse-pointer class names; suites and `vite build` pass.

## Expected Areas of Change
`web/src/index.css`, `web/src/components/IconButton.jsx`, `ChatPanel.jsx`, `ChannelList.jsx`, `DmSidebar.jsx`, `MemberList.jsx`, `MessageList.jsx` (reaction / chip classes), `Composer.jsx`, `ThreadPanel.jsx`, plus tests.

## Working Set / Blast Radius
About 9 files, all class-level changes; no state or API changes. Risk: a coarse-pointer rule that also hits desktop touchscreens (acceptable, they benefit too).

## Testing Strategy
Vitest for the More menu and class presence; the sandbox measurement script at 375 px and 1280 px for AC-1 and AC-2 (the pane's mobile preset emulates a coarse pointer).

## Out of Scope
Safe-area insets and `100dvh` (M3, recorded in P4-00), thread back button (P4-07).

## Verification Evidence
| Acceptance Criterion | Status | Verification Type | Evidence |
|---|---|---|---|
| AC-1 | Not verified | | |
| AC-2 | Not verified | | |
| AC-3 | Not verified | | |
| AC-4 | Not verified | | |
