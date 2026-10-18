# P3-20b — Small fixes: first server, DM divider, two accessibility fixes

- **Unit Type:** Implementation (child of P3-20)
- **Phase:** 3
- **State:** REVIEW
- **Effort:** S–M
- **Depends on:** none. Branched from P3-20a (#129) only to keep INDEX.md conflict-free; merge after it.
- **Serialize with:** `ChatPanel.jsx`, `ServerRail.jsx`, `App.jsx`, `useDms.js`, `MemberList.jsx`, `index.css`

## Scope
- **First server from the empty screen** (P4-03 note): when you're in no servers, the main area says "You're not in any servers yet" and offers **Create a server** and **Join with an invite**. Both open the rail's existing Add-a-server dialog on that tab (a new `openRequest` prop). With servers but none picked, the old hint stays.
- **DM new-messages divider** (P2-05 note): opening a DM with unread messages shows the "New" divider before the first of them (and the "more new messages above" bar when they go back further than what's loaded), once per visit, the same as channels. DMs keep no last-read id in the app, so `dmSince` (in `newMessages.js`) derives it from the unread count: the partner's newest *count* messages are the new ones.
- **Offline members** (P4-06 note, axe `color-contrast`): no more `opacity-50` on the whole row. The name uses `text-gray-500` (checked for AA in both themes by `theme.contrast.test.js`), and the avatar is greyscale.
- **Links in messages** (P4-06 note, axe `link-in-text-block`): underlined at rest with a quieter line (45% of the link colour, 2 px offset), full colour on hover. They're no longer told apart by colour alone.

## Acceptance criteria
- [x] The empty screen with no servers shows both buttons, and they ask for `create` / `join`; with servers but none picked, the old hint and no buttons; the rail opens its dialog on the requested tab.
- [x] `dmSince`: before the first of the partner's newest `count`; more than loaded → before the first loaded; none → null. `useDms`: opening a DM with 2 unread gives `{ since, count: 2 }`, then marks it read; leaving clears it. MessageList draws "New" in a DM.
- [x] Offline names are `text-gray-500` with a greyscale avatar and no opacity; online names stay `text-gray-200`.
- [x] `.md-link` is underlined at rest.
- [x] All suites pass; `vite build` is clean.
- [x] Sandbox: a DM divider live.

## Evidence (2026-10-18)
| Acceptance criterion | Evidence |
|---|---|
| First server | `SmallFixes.test.jsx`: "You're not in any servers yet" with Create a server / Join with an invite → `onAddServer('create')`, `('join')`; servers but none picked → "No server selected", no buttons. `ServerRail` with `openRequest: { tab: 'join', n: 1 }` opens the dialog on Join |
| DM divider | `newMessages.test.js` (`dmSince`: 1 → 12, 2 → 11, 3 → 9, 7 → 9, 0 → null, empty → null). `useDms.test.js`: `dm_unread` bob: 2, then select bob → `newMessages` `{ since: 2, count: 2 }` and `dm_read` up to 4; deselect → null. `SmallFixes.test.jsx`: a `simple` MessageList with `newMessages` shows "New" |
| Offline members, links | `SmallFixes.test.jsx`: offline bob `text-gray-500`, `.grayscale` avatar, no `opacity-50`; online ann `text-gray-200`. The `.md-link` rule has `text-decoration: underline` and not `none` |
| Suites | Web: 71 files, 599 tests (the theme contrast test still passes with `gray-500` on every surface). `vite build` clean. No server change |
| Sandbox | Sandy on Tx Check; bob sent her two DMs ("Direct Messages, 2 unread"). Opening the DM showed "… P210 DM reply check │ Today │ **NEW** │ bob: hey, are you around? (divider check 1) │ second one (divider check 2)" |
