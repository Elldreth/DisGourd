# P4-06 — Hierarchy and accessibility polish

- **Unit Type:** Implementation (child of P4-00)
- **Phase:** 4
- **State:** READY
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
- [ ] AC-1: axe-core on the main screen (titles stripped) reports zero violations (was: `page-has-heading-one`, `region`).
- [ ] AC-2: the two selects and two checkboxes in Settings have accessible names that match their captions (read_page / Testing Library `getByLabelText`).
- [ ] AC-3: at 1280 px the message toolbar's bounding box does not intersect the message text's box on a one-line message.
- [ ] AC-4: at 375 px the thread chip shows the full first 20 characters of the thread name and the reply count.
- [ ] AC-5: visual items 1, 2, 4, 5, 10 have before/after screenshots in the evidence, dark and light.
- [ ] AC-6: suites and build pass; `theme.contrast.test.js` still passes with the leaf change.

## Expected Areas of Change
`ServerRail.jsx`, `ChannelList.jsx` (menu, nav), `MessageList.jsx` (timestamps, toolbar, chip), `MessageActions.jsx`, `AuthShell.jsx`, `ThreadPanel.jsx`, `AudioSettings.jsx`, `App.jsx` (h1), `DmSidebar.jsx`, `Gourd.jsx`, `index.css`, tests.

## Working Set / Blast Radius
About 11 files, a few lines each. Risk: none of these change behaviour; the Gourd change affects the favicon-style uses, so check the rail and auth screens in both themes.

## Testing Strategy
Vitest for A2, A3 (landmarks present), V2 (chip classes); axe in the sandbox for AC-1; a script for AC-3; screenshots for the rest.

## Out of Scope
Touch sizes (P4-01), thread back button (P4-07), anything in the settings layout (P4-02).

## Verification Evidence
| Acceptance Criterion | Status | Verification Type | Evidence |
|---|---|---|---|
| AC-1 | Not verified | | |
| AC-2 | Not verified | | |
| AC-3 | Not verified | | |
| AC-4 | Not verified | | |
| AC-5 | Not verified | | |
| AC-6 | Not verified | | |
