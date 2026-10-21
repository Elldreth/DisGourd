# P10-03 — Blocking polish: collapsed row, menus, pickers, member mark, Undo, DM header ⋯

- **Unit Type:** Implementation (child of P10-00)
- **Phase:** 10
- **State:** REVIEW
- **Effort:** M
- **Depends on:** P9-07
- **Serialize with:** P10-01 (message menu), P10-04 (`MessageList.jsx`, `DmPanel.jsx`)
- **Requirement Source:** `design/design-review-p10/REVIEW.md` B1–B6.

## Scope
- The collapsed row is full width with an eye-off icon in the avatar column and normal text: "3 messages from someone you blocked · Show". It breaks author grouping.
- Block… in the member and message menus is plain with a ⊘ icon, in the personal group, above the moderation divider.
- The New message picker and the people picker show a blocked match greyed: "dee · You blocked them", with **Unblock**.
- A ⊘ mark after blocked names in the member list and the group Members dialog (with screen-reader text).
- The "Blocked dee" toast gets **Undo**.
- A 1-to-1 header gets **⋯** with Add people…, Mute / Unmute (the existing `dm_mute`) and Block <name>…; Search stays an icon.

## Acceptance criteria
- [x] AC-1: the collapsed row is not inside the previous author's group (DOM and screenshot), and its text isn't italic.
- [x] AC-2: Block… has the same colour in both menus, and it isn't amber.
- [x] AC-3: typing a blocked person's name in New message shows them with Unblock, which works.
- [x] AC-4: Undo on the toast unblocks.
- [x] AC-5: a 1-to-1 can be muted from ⋯; muted rows dim as groups do.
- [x] AC-6: axe clean on a channel with a blocked row and on the DM header menu.

## Expected Areas of Change
MessageList.jsx, MemberList.jsx, DmPanel.jsx, PeoplePicker.jsx, the New message picker, App.jsx (toast), tests.

## As built
- **The collapsed row** (`MessageList`) is its own full-width row: an eye-off icon in the avatar column, then "A message / n messages from someone you blocked · Show", in plain text, with a new author's spacing (`mt-3`), so it doesn't sit under the previous person's group.
- **Block in menus:**
  - Member menu: **Block…** is plain text in the personal group (Message, Roles…), no longer the moderators' amber.
  - Message menu: Report… and Block … share a divided group (from P10-01).
- **A blocked mark** (⊘, "Blocked" for screen readers) after the name in the member list and the group Members dialog.
- **Pickers** (`BlockedMatches.jsx`, used by New message and the group picker):
  - A search that matches someone you blocked shows them greyed, "· You blocked them", with **Unblock**, instead of "No one by that name".
  - After Unblock, focus goes back to the search box, because the button disappears. Found live: otherwise Esc no longer closed the picker.
- **Undo:** the "Blocked dee" toast has **Undo**, which unblocks.
- **The 1-to-1 header:** the bare ⊘ and + icons are replaced by a **⋯** menu with Add people…, **Mute / Unmute** (the existing `dm_mute`; new for 1-to-1s) and, after a divider, Block <name>…. Search stays an icon. With nothing to offer (you blocked them, and it isn't saved yet), the ⋯ is hidden.
- **Older tests updated:** the blocking test (new wording, the menu path) and groupDms (Add people via ⋯).

## Verification Evidence
| Acceptance Criterion | Status | Verification Type | Evidence |
|---|---|---|---|
| AC-1 | Verified | `blocking.test.jsx` + sandbox | The row has `mt-3`, no italics, its own avatar column (`shots/p10-03-blocked-row.jpg`) |
| AC-2 | Verified | Test | Block… in the member menu isn't `text-idle`; both menus are plain |
| AC-3 | Verified | Test + sandbox | "dee · You blocked them · Unblock" (`shots/p10-03-picker-blocked.jpg`). Unblock then lists dee as a member, with focus in the search box |
| AC-4 | Verified | Sandbox | "Blocked dee · Undo" (`shots/p10-03-undo-toast.jpg`) |
| AC-5 | Verified | Test + sandbox | ⋯ → Mute: cara's row became "cara…, muted"; ⋯ then showed Unmute, which undid it (`shots/p10-03-dm-more-menu.jpg`) |
| AC-6 | Verified | axe-core 4.10.2 | A channel with a blocked row and the member mark: no violations, dark or light (`shots/p10-03-light.jpg`) |
| Suites | Verified | Vitest, Jest, Vite | Web 104 files / 825 tests; server 53 suites / 461 tests; `vite build` clean |

## Notes
- During one full run, server `change-password.test.js` failed while the web suite ran alongside. Alone, and in a full run on its own, it passes, and this branch changes nothing on the server. It looks like a timing flake under load. Recorded, not fixed here.

## kie.ai spend
None.

## Not in scope
Anything not listed above. Other findings in the review belong to their own pass.
