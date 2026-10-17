# P4-04 — New message from the DM view

- **Unit Type:** Implementation (child of P4-00)
- **Phase:** 4
- **State:** REVIEW (branch `claude/p4-04-new-dm`, PR pending)
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
- [x] AC-1: from the DM view, one click on "New message", typing a name and Enter opens (or creates) that DM. Works for a user you have never messaged.
- [x] AC-2: the people list contains members of your servers and excludes yourself; it never shows users from servers you are not in.
- [x] AC-3: keyboard: the button is focusable and labelled; the switcher's existing arrow/Enter/Esc behaviour works in people mode.
- [x] AC-4: web tests for the people mode (list source, exclusion, selection) and the button; suites and build pass.

## Expected Areas of Change
`web/src/components/DmSidebar.jsx`, `QuickSwitcher.jsx` (mode prop), `App.jsx` (wiring and the shortcut), `shortcuts.js`, tests. If the client lacks a "members of all my servers" list, derive it from `spaces[].members` already held in state (check `useSpaces.js`); no server change expected.

## Working Set / Blast Radius
4–5 files. Risk: the member data for non-current servers may only be loaded on demand; if so, fall back to current-server members plus existing conversations and note it in Discovered Work.

## Testing Strategy
Vitest for the switcher mode and the sidebar button; sandbox: sandy starts a DM with cara from the DM view at 375 px and 1280 px.

## Out of Scope
Group DMs, a user directory, searching users server-side.

## Starting Baseline
Revision: `main` after #105. Clean worktree `.claude/worktrees/p4-shine`. Web suite 55 files / 487 tests green.

## Implementation notes
- `QuickSwitcher.jsx`: a `mode="people"` prop. The dialog is labelled "New message", the combobox "Message who?", the list "People"; rows of a new kind `person` show "member"; the footer reads "Enter to message"; the empty text says people you share a server with show up here. `peopleItems({ me, conversations, unread, members })` builds the list: conversations first (as `dm` rows with their unread counts), then members not already listed (as `person`), never `me`, no repeats.
- `App.jsx`: `openPeoplePicker()` loads the conversation list if needed, opens the switcher in people mode and fetches `api.getMembers` for every server you are in (`sp.spaces`), in parallel, failures ignored; the list shows conversations at once and the members as they arrive. `goToPicked` already treats anything that isn't a channel or server as a DM, so a `person` pick calls `startDm`.
- `shortcuts.js`: Ctrl/Cmd+Shift+K → `'people'` (was unassigned); the switcher footer and the button tooltip mention it.
- `DmSidebar.jsx`: a `tap`-sized pencil `IconButton` "New message" in the header and a "New message" button in the empty state (the old "open a member in a server" text is gone). `DmPanel.jsx`: the home card's copy and a "New message" button, both only when `onNewMessage` is passed.

## Verification Evidence
| Acceptance Criterion | Status | Verification Type | Evidence |
|---|---|---|---|
| AC-1 | Verified | Sandbox (P4 copy of the sandbox DB on :3007, 1280px) + `newDm.test.jsx` | From the DM view: New message → dialog "New message", prompt "Message who?", rows "cara · direct message · 2", "bob · direct message"; typing "ca" and Enter closed the picker and opened the DM with cara (header "cara", composer "Message @cara"). Never-messaged users: the sandbox has none (every member already has a conversation with sandy), so that path is covered by the unit test, where Enter on "da" picks `{ kind: 'person', username: 'dave' }` |
| AC-2 | Verified | Unit test + sandbox network log | `peopleItems`: sandy (me) excluded, bob (already a conversation) not repeated, dave (in two servers) listed once, erin listed. Sandbox: opening the picker requested `/spaces/Tx Check/members` and `/spaces/Smoke Test/members` (both 200), i.e. every server sandy is in and nothing else |
| AC-3 | Verified | Test + sandbox | Header button is a named `IconButton` (44×44 at 375px, coarse pointer); the picker's combobox gets focus on open, ↑↓/Enter/Esc work as before (the existing QuickSwitcher tests still pass); Ctrl+Shift+K opened the picker in the sandbox and `matchShortcut` returns `'people'` for it |
| AC-4 | Verified | Vitest, Vite | `newDm.test.jsx`: 6 tests (watched fail first, then pass). `shortcuts.test.js` updated (Ctrl+Shift+K is now a shortcut). Full web suite 56 files / 493 tests green; `vite build` clean. Phone: dialog 343px wide, page scrollWidth 375 (no horizontal scroll) |
