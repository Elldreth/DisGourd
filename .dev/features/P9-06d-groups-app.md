# P9-06d — Group DMs in the app

- **Unit Type:** Implementation (child of P9-06)
- **Phase:** 9
- **State:** READY (once P9-06c merges)
- **Effort:** M
- **Depends on:** P9-06c

## Scope
- **Starting a group:** the people picker (new DM) allows picking several people. With 2 or more, it says "Start a group (n people)". Only people you share a server with, or friends, are offered, matching the server's rule.
- **From a 1-to-1:** the DM header gets **Add people**. It opens the picker with that person already in, and creates a **new** group. The note says: "This starts a new group. Your messages with bob stay private."
- **The sidebar:** group rows show a group avatar (two or three member avatars stacked, or the count), the name (or member names) and "n members". Muted groups are dimmed and get no sound.
- **The header:** the name and the member count, plus a **Members** button that opens the members dialog:
  - The member list, with the owner marked.
  - **Add people**, up to 10 in total.
  - **Remove**, shown to the owner only. It asks first.
  - **Rename** (any member) and **Mute** (a switch).
  - **Leave group**. It asks first, and the owner sees who takes over.
- **In the chat:** system notices render as centered gray lines with no actions. The typing line shows names ("bob and cara are typing…").
- **Leaving or being removed:** the app closes the conversation and shows a toast ("You left Gourd Club" or "You were removed from Gourd Club").
- **Notifications:** desktop notifications and pushes show "Group: sandy" with the message. Muted groups are silent.

## Acceptance criteria
- [ ] **Web:** picking several people creates a group; Add people from a 1-to-1 makes a new group; the members dialog works (add, owner-only remove, rename, mute, leave with confirm); sidebar rows and the group avatar; system notices; typing names; the toast and close when removed; muted groups stay silent.
- [ ] **All suites pass;** `vite build` is clean.
- [ ] **Sandbox, in two browsers** (sandy, bob; cara via script): make a group, rename it, add cara, and chat. Then mute, have bob leave, and remove a member, checking what each person sees.
