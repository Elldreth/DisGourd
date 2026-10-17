# P3-08 — In-app confirm dialog for kick and delete server

- **Unit Type:** Implementation
- **Phase:** 3 — "Replace window.confirm"
- **State:** REVIEW (PR open)
- **Effort:** S
- **Depends on:** P3-01
- **Serialize with:** MemberList.jsx (P3-10), ChannelList.jsx units
- **Requirement Source:** IMPROVEMENT-PLAN.md Phase 3. Revalidated: `window.confirm` appears at `MemberList.jsx:29` (kick), `ChannelList.jsx:192` (delete server) and `MessageList.jsx:313` (delete message, which is handled by P3-09).

## Scope
- New `web/src/components/ConfirmDialog.jsx` (built on Modal) with props `{ title, body, confirmLabel, danger, requireText }`. Focus starts on Cancel for danger actions.
- Kick: "Remove @x from <server>? They can rejoin with an invite."
- Delete server: requires typing the server name (`requireText`) before the button enables.

## Acceptance criteria
- [x] No `window.confirm` remains in MemberList or ChannelList.
- [x] Delete server stays disabled until the exact name is typed. Esc or Cancel aborts.
- [x] Keyboard-only flow works.

## Expected Areas of Change
New `ConfirmDialog.jsx`, `MemberList.jsx`, `ChannelList.jsx`.

## Working Set / Blast Radius
3 files.

## Evidence
| Check | Result |
|---|---|
| `ConfirmDialog.test.jsx` (7, with `window.confirm` made to throw): dialog named by the question, body shown; danger -> focus on Cancel; confirm / Cancel / Esc; `requireText`: disabled until the exact (case-sensitive) text, Enter only confirms once it matches, focus starts in the box; kick asks in-app ("Remove @bob from Tx Check?"), Cancel keeps bob, Remove calls `onKick('bob')`; delete server needs the name typed, then deletes; Esc keeps the server | pass (the 3 call-site tests failed first; the 4 ConfirmDialog tests were written with it, not seen failing first) |
| `grep window.confirm` | none in MemberList / ChannelList (only MessageList's delete-message one remains, which is P3-09) |
| Full suite / build | web 328/328, lint clean, build ok |
| Sandbox, kick by keyboard (desktop): bob's row, Enter, Tab x3 -> "Remove from server", Enter -> "Remove @bob from Tx Check?" + "They can rejoin with an invite.", focus on Cancel; Esc -> closed, focus back on bob's row, bob still a member | pass |
| Sandbox, kick inside the member drawer (below lg): Esc closes only the confirm; the drawer stays open, focus on bob's row | pass |
| Sandbox, delete server by keyboard (throwaway server "Throwaway"): server button, Enter, Tab x5 -> "Delete server", Enter -> "Delete Throwaway?", focus in the name box, button disabled; typed "throwaway" + Enter -> nothing; Ctrl+A, "Throwaway" -> enabled; Enter -> deleted, app moved to another server; screenshot checked; Cancel on Tx Check kept it; no console errors | pass |

## Implementation notes
- `ConfirmDialog` (on Modal): `{ title, body, confirmLabel, danger, requireText, onConfirm, onCancel }`. Danger confirm button uses the danger fill with ink-900 text (AA in both themes, see P2-17). With `requireText`, focus starts in the text box rather than on Cancel: typing is the required step, and the confirm can't fire until it matches.
- Kick: the member's row button takes focus before the dialog opens (the menu item it came from disappears), so focus returns to the row. `App` passes `space` to MemberList for the question.
- Delete server: the menu already returns focus to the server button (P3-01), so the dialog returns focus there on Cancel.

## Not verified
- A real screen reader.
