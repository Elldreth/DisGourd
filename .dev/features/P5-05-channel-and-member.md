# P5-05 — Channel settings tabs and the member menu header

- **Unit Type:** Implementation (child of P5-00)
- **Phase:** 5
- **State:** PLANNED (needs P5-02 and P5-01)
- **Effort:** M
- **Depends on:** P5-02 (kit), P5-01 (menu dismissal)
- **Serialize with:** anything editing `ChannelSettingsDialog.jsx`, `MemberList.jsx`
- **Requirement Source:** `design/settings-review-2026-10/REVIEW.md` C1 and M2.

## Scope
- Channel settings get three tabs inside the dialog: **Overview** (topic, category, 18+, danger zone with Delete channel), **Permissions** (the view/post table), **Moderation** (slow mode). One Save for the dialog, as today, through the `SaveBar`. The Move up/down buttons are labelled "Move channel up/down" and sit under the category picker.
- Member menu: a header with avatar, name, top role and status; then Message and Roles…; a divider; then Time out… (amber), Remove from server and Ban… (red).

## Acceptance criteria
- [ ] AC-1: slow mode and 18+ are visible without scrolling at 1024×768 on their tabs.
- [ ] AC-2: saving from any tab sends the same request(s) as today for the same edits (existing `ChannelSettings`/`Slowmode`/`ChannelTopics` tests pass with the same assertions).
- [ ] AC-3: the member menu names the member in its header and its accessible name ("Actions for bob").
- [ ] AC-4: moderation items appear below a separator, Time out uses the idle colour, Remove and Ban the danger colour; items you lack permission for are still hidden.

## Expected Areas of Change
`ChannelSettingsDialog.jsx`, `MemberList.jsx`, tests.

## Working Set / Blast Radius
2 components and their tests.

## Testing Strategy
Existing tests first (green), then tab and header tests; a sandbox walk as sandy (owner) and bob (mod).

## Out of Scope
Channel rename (needs a route, discovered work).

## Starting Baseline
To be recorded at activation.
