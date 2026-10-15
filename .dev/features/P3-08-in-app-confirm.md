# P3-08 — In-app confirm dialog for kick and delete server

- **Unit Type:** Implementation
- **Phase:** 3 — "Replace window.confirm"
- **State:** PLANNED (READY after P3-01)
- **Effort:** S
- **Depends on:** P3-01
- **Serialize with:** MemberList.jsx (P3-10), ChannelList.jsx units
- **Requirement Source:** IMPROVEMENT-PLAN.md Phase 3. Revalidated: `window.confirm` appears at `MemberList.jsx:29` (kick), `ChannelList.jsx:192` (delete server) and `MessageList.jsx:313` (delete message, which is handled by P3-09).

## Scope
- New `web/src/components/ConfirmDialog.jsx` (built on Modal) with props `{ title, body, confirmLabel, danger, requireText }`. Focus starts on Cancel for danger actions.
- Kick: "Remove @x from <server>? They can rejoin with an invite."
- Delete server: requires typing the server name (`requireText`) before the button enables.

## Acceptance criteria
- [ ] No `window.confirm` remains in MemberList or ChannelList.
- [ ] Delete server stays disabled until the exact name is typed. Esc or Cancel aborts.
- [ ] Keyboard-only flow works.

## Expected Areas of Change
New `ConfirmDialog.jsx`, `MemberList.jsx`, `ChannelList.jsx`.

## Working Set / Blast Radius
3 files.
