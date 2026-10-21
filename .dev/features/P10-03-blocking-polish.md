# P10-03 — Blocking polish: collapsed row, menus, pickers, member mark, Undo, DM header ⋯

- **Unit Type:** Implementation (child of P10-00)
- **Phase:** 10
- **State:** PLANNED
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
- [ ] AC-1: the collapsed row is not inside the previous author's group (DOM and screenshot), and its text isn't italic.
- [ ] AC-2: Block… has the same colour in both menus, and it isn't amber.
- [ ] AC-3: typing a blocked person's name in New message shows them with Unblock, which works.
- [ ] AC-4: Undo on the toast unblocks.
- [ ] AC-5: a 1-to-1 can be muted from ⋯; muted rows dim as groups do.
- [ ] AC-6: axe clean on a channel with a blocked row and on the DM header menu.

## Expected Areas of Change
MessageList.jsx, MemberList.jsx, DmPanel.jsx, PeoplePicker.jsx, the New message picker, App.jsx (toast), tests.

## Not in scope
Anything not listed above. Other findings in the review belong to their own pass.
