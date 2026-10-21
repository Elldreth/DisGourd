# P10-04 — Group DMs polish: picture, previews, welcome art, Members dialog, notice contrast

- **Unit Type:** Implementation (child of P10-00)
- **Phase:** 10
- **State:** PLANNED
- **Effort:** S–M
- **Depends on:** P9-06; P10-08 for the group scene (optional)
- **Serialize with:** P10-03 (`MessageList.jsx`, `DmPanel.jsx`)
- **Requirement Source:** `design/design-review-p10/REVIEW.md` G1–G4, X2.

## Scope
- GroupAvatar: one other member → their full-size avatar plus a small group badge. Two or more → two avatars at about 70%, overlapping about a third, with a ring and the +n chip.
- Group previews name the sender: "bob: …" / "You: …".
- A new group's welcome uses a three-gourd scene and lists the members' names.
- Members dialog: Done is the filled primary; Add people is a + button, disabled at 10 with a reason.
- Bug X2: notice times use `text-gray-500` (≥4.5:1).

## Acceptance criteria
- [ ] AC-1: a group with one other member shows a 32 px avatar, centred, in the sidebar and the header.
- [ ] AC-2: a group row's preview starts with the sender's name.
- [ ] AC-3: axe shows no contrast failure on a group with a notice.
- [ ] AC-4: GroupAvatar tests cover 1, 2 and 4+ members.

## Expected Areas of Change
GroupAvatar.jsx, DmSidebar.jsx, DmPanel.jsx, GroupMembersDialog.jsx, MessageList.jsx, tests.

## Not in scope
Anything not listed above. Other findings in the review belong to their own pass.
