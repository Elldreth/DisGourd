# P5-05 — Channel settings tabs and the member menu header

- **Unit Type:** Implementation (child of P5-00)
- **Phase:** 5
- **State:** REVIEW (PR open, 2026-10-19)
- **Effort:** M
- **Depends on:** P5-02 (kit), P5-01 (menu dismissal)
- **Serialize with:** anything editing `ChannelSettingsDialog.jsx`, `MemberList.jsx`
- **Requirement Source:** `design/settings-review-2026-10/REVIEW.md` C1 and M2.

## Scope
- Channel settings get three tabs inside the dialog: **Overview** (topic, category, 18+, danger zone with Delete channel), **Permissions** (the view/post table), **Moderation** (slow mode). One Save for the dialog, as today, through the `SaveBar`. The Move up/down buttons are labelled "Move channel up/down" and sit under the category picker.
- Member menu: a header with avatar, name, top role and status; then Message and Roles…; a divider; then Time out… (amber), Remove from server and Ban… (red).

## Acceptance criteria
- [x] AC-1: slow mode and 18+ are visible without scrolling at 1024×768 on their tabs.
- [x] AC-2: saving from any tab sends the same request(s) as today for the same edits (existing `ChannelSettings`/`Slowmode`/`ChannelTopics` tests pass with the same assertions).
- [x] AC-3: the member menu names the member in its header and its accessible name ("Actions for bob").
- [x] AC-4: moderation items appear below a separator, Time out uses the idle colour, Remove and Ban the danger colour; items you lack permission for are still hidden.

## Expected Areas of Change
`ChannelSettingsDialog.jsx`, `MemberList.jsx`, tests.

## Working Set / Blast Radius
2 components and their tests.

## Testing Strategy
Existing tests first (green), then tab and header tests; a sandbox walk as sandy (owner) and bob (mod).

## Out of Scope
Channel rename (needs a route, discovered work).

## Starting Baseline
Revision: `5c93472` (main after #162). Web suite before: 86 files / 711 tests.

## Implementation notes
- `ChannelSettingsDialog`:
  - Tabs (a real tablist, arrow keys): **Overview** (topic, category and the move buttons, the 18+ switch, a danger zone with Delete channel), **Permissions** (the role table and its help text) and, for text channels, **Moderation** (slow mode).
  - Voice channels have Overview and Permissions. A category's permissions have no tabs.
  - Every tab stays mounted, and one Save sends what changed on all of them.
  - The header uses `Modal.Header`.
- **Deviation:** the packet said the SaveBar; I kept the footer Save/Cancel. This is a small dialog that closes when you save, and the footer is the clearer commit for it. The SaveBar is for the large settings windows, where you keep working after saving. The save behaviour is unchanged.
- **Found in the sandbox and fixed:** with tabs, the dialog changed height per tab and re-centred, so the tab row moved (the same problem P5-02 fixed in Settings). The body now has a fixed height (`min(28rem, 65vh)`), and the tabs stay at the same y on all three. `shots/p5-05-channel-permissions.jpg` and `p5-05-channel-moderation.jpg` were taken before this fix; Overview is after.
- The move buttons are labelled "Move channel up/down" and sit under the category picker, with "Moves happen right away. You can also drag channels in the list."
- Member menu:
  - A `group` named "Actions for bob". Its header shows the avatar with the status dot, the name in role colour, then "top role · status".
  - Message and Roles… come first. After a separator: Time out… (or Remove timeout), Remove from server, Ban…, always in that order.
  - Time out… is amber (`text-idle`, reversible); Remove and Ban are red.
- Tests changed only where names changed: `ChannelCategories.test` ("Move up" → "Move channel up"), `ImagineSwitches.test` (18+ checkbox → switch), and `QuickFixes.test` (the member row is the first "bob" now that the open menu names bob too).

## Verification Evidence
| Acceptance Criterion | Status | Verification Type | Evidence |
|---|---|---|---|
| AC-1 | Verified | Sandbox (server :3005, this branch's dev server :5175) + test | Slow mode is on Moderation and 18+ on Overview, each visible without scrolling; the panel scroll ratio is 1.00 on all three tabs at 1024×768. `ChannelAndMember.test.jsx` covers the tabs per channel kind |
| AC-2 | Verified | Tests + sandbox | Existing `ChannelTopics`, `Slowmode`, `ChannelCategories` and `RolesDialog` (channel part) tests pass. New test: edits on three tabs → topic, slow mode and overrides all sent. Sandbox: #general slow mode set to 5 seconds and saved (the dialog closed; it reopened with 5), then back to Off |
| AC-3 | Verified | Test + sandbox | `group` "Actions for bob"; the header reads "bob · Mods · Offline" in the sandbox (`shots/p5-05-member-menu*.png/jpg`) |
| AC-4 | Verified | Tests + sandbox | The order is Message, Roles…, separator, Time out…, Remove from server, Ban…. With no moderation permissions there's no separator. Contrast against the menu: Time out 12.1:1 (dark) / 5.1:1 (light); Remove 6.9 / 6.6 |
| Suites | Verified | Vitest, Vite | Web 87 files / 718 tests; `vite build` clean |
