# P4-04 — New message from the DM view

- **Unit Type:** Implementation (child of P4-00)
- **Phase:** 4
- **State:** READY
- **Effort:** S
- **Depends on:** none (uses `EmptyState` from P4-03 if it has landed, otherwise edits the text in place)
- **Serialize with:** P4-03 (`DmSidebar.jsx`), anything editing `QuickSwitcher.jsx` or `App.jsx`
- **Requirement Source:** `design/UX-REVIEW-2026-10.md` F2. The DM column has no way to start a conversation; the only route is a server's member list (five taps on a phone).

## Scope
- A "New message" icon button (plus) in the `DmSidebar` header, 44 px on phones.
- It opens the existing `QuickSwitcher` in a `people` mode: prompt "Message who?", list = every user you share a server with (the data the switcher already builds for its DM rows, widened to members of your servers rather than only existing conversations), fuzzy match as now, Enter opens the DM.
- The DM empty-state text ("No conversations yet…") and the DM home card get the same action.
- Shortcut: `Ctrl+Shift+K` opens the people mode from anywhere (listed in the switcher footer).

## Acceptance criteria
- [ ] AC-1: from the DM view, one click on "New message", typing a name and Enter opens (or creates) that DM. Works for a user you have never messaged.
- [ ] AC-2: the people list contains members of your servers and excludes yourself; it never shows users from servers you are not in.
- [ ] AC-3: keyboard: the button is focusable and labelled; the switcher's existing arrow/Enter/Esc behaviour works in people mode.
- [ ] AC-4: web tests for the people mode (list source, exclusion, selection) and the button; suites and build pass.

## Expected Areas of Change
`web/src/components/DmSidebar.jsx`, `QuickSwitcher.jsx` (mode prop), `App.jsx` (wiring and the shortcut), `shortcuts.js`, tests. If the client lacks a "members of all my servers" list, derive it from `spaces[].members` already held in state (check `useSpaces.js`); no server change expected.

## Working Set / Blast Radius
4–5 files. Risk: the member data for non-current servers may only be loaded on demand; if so, fall back to current-server members plus existing conversations and note it in Discovered Work.

## Testing Strategy
Vitest for the switcher mode and the sidebar button; sandbox: sandy starts a DM with cara from the DM view at 375 px and 1280 px.

## Out of Scope
Group DMs, a user directory, searching users server-side.

## Verification Evidence
| Acceptance Criterion | Status | Verification Type | Evidence |
|---|---|---|---|
| AC-1 | Not verified | | |
| AC-2 | Not verified | | |
| AC-3 | Not verified | | |
| AC-4 | Not verified | | |
