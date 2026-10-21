# P10-04 — Group DMs polish: picture, previews, welcome art, Members dialog, notice contrast

- **Unit Type:** Implementation (child of P10-00)
- **Phase:** 10
- **State:** COMPLETE (merged #205)
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
- [x] AC-1: a group with one other member shows a 32 px avatar, centred, in the sidebar and the header.
- [x] AC-2: a group row's preview starts with the sender's name.
- [x] AC-3: axe shows no contrast failure on a group with a notice.
- [x] AC-4: GroupAvatar tests cover 1, 2 and 4+ members.

## Expected Areas of Change
GroupAvatar.jsx, DmSidebar.jsx, DmPanel.jsx, GroupMembersDialog.jsx, MessageList.jsx, tests.

## As built
- **`GroupAvatar`** (redrawn):
  - Two or more people: two avatars at two thirds of the size, corner to corner, so the back one's initials sit clear of the front one, plus "+n".
  - One other person (everyone else left): their full-size avatar with a small group badge (the users icon).
  - Nobody: a plain violet group tile.
- **Previews:**
  - **Server:** `getDmConversations` adds `lastAuthorId` and `lastKind` from the last message. These are two more columns in the existing query, with no new route and no migration.
  - **App:** `DmSidebar.groupPreview()` prefixes a group's preview with "bob: " or "You: ". It leaves notices ("bob started the group"), pairs, and rows from an older server alone.
- **The group welcome:** `EmptyState` art `group` uses the P10-08 group scene (`GroupParts` in `Mascot.jsx`). The body reads "You, bob and cara. Say hi! 👋".
- **Members dialog:** Done is the filled brand button. Add people is a real button with a +; at 10 people it's off and says "Groups hold up to 10 people."
- **Bug X2 (contrast):** the time on group notices is `text-gray-500`, not `text-gray-600`.
- **Not done:** a ready-made group picture (choosing the P10-08 "group" tile for a named group) needs storage on the server for a group's picture. That's left for later, as the review said ("can set" is an option, not part of this pass).

## Verification Evidence
| Acceptance Criterion | Status | Verification Type | Evidence |
|---|---|---|---|
| AC-1 | Verified | `groupDms.test.jsx` + sandbox | One other person: the 32 px avatar with a badge (Squash Squad in `shots/p10-04-dm-list.jpg`) |
| AC-2 | Verified | Test + this branch's server (:3009, on a copy of the sandbox DB) | "bob: bring snacks on Friday?"; the notices unchanged |
| AC-3 | Verified | axe-core 4.10.2 | The group view with a notice, and the Members dialog: no violations, dark or light (`shots/p10-04-light.jpg`) |
| AC-4 | Verified | Test | 0, 1, 2 and 4 members |
| Server field | Verified | `server/tests/dm-groups.test.js` | `lastAuthorId` / `lastKind` for a notice and for a message |
| Suites | Verified | Vitest, Jest, Vite | Web 104 files / 829 tests; server 53 suites / 461 tests; `vite build` clean |

## Sandbox note
- **New local launch configs** (uncommitted): `app-p10` runs this worktree's server on :3009 with `%TEMP%/disgourd-sandbox-p10.db` (a copy of the sandbox DB), and `web-p10b` (:5176) points at it. They're for passes that change the server.

## kie.ai spend
None (the scene came from P10-08).

## Not in scope
Anything not listed above. Other findings in the review belong to their own pass.
