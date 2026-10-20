# P9-06d — Group DMs in the app

- **Unit Type:** Implementation (child of P9-06)
- **Phase:** 9
- **State:** REVIEW
- **Starting baseline:** main at 35e1998 (#193 merged)
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

## As built
- **`useDms`:**
  - New handlers: `dm_conversation` (adds or updates a row), `dm_group_created` (opens it), `dm_left` (drops it, closes it, calls `onLeft`) and `error` (keeps group refusals as `groupError`).
  - Actions: `createGroup`, `addToGroup`, `removeFromGroup`, `leaveGroup`, `renameGroup`, `setMuted` and `title(c)`.
  - `conversationTitle` and `MAX_GROUP` are exported.
  - Notices are kept with `kind: 'system'` and don't reach notifications.
  - A group frame from someone can't take over a just-started 1-to-1 with them (pairs only).
- **`PeoplePicker.jsx`** (new): a multi-person picker with search, picked chips, locked people, min/max, an optional group name, a note and a confirm label. It's used for:
  - **Start a group** (from the New message picker's new "Start a group" button);
  - **Add people** in a 1-to-1's header (that person locked in; "This starts a new group. Your messages with bob stay private.");
  - **Add people** in the Members dialog (current members left out; up to 10).
  - People offered: members of your servers plus friends, never you.
- **`GroupMembersDialog.jsx`** (new):
  - Members in join order, with "(you)" and Owner.
  - Remove (owner only; asks), Add people (off at 10), Rename (when changed), Mute (switch).
  - Leave group (asks; the owner sees who takes over; the last one is told it'll be deleted).
- **`GroupAvatar.jsx`** (new): two overlapping member avatars and a "+n" chip.
- **The sidebar:** group rows (avatar, title, last message or "n members"); muted rows dimmed with ", muted" for screen readers.
- **The header:** a group shows its title, "n members" and a Members button; a pair, "Add people". The placeholder and empty heading name the group.
- **`MessageList`:** notices render as a centered gray line (`role="note"`) with no actions and break author grouping. The composer's up arrow skips them.
- **`notify.js`:** muted conversations neither notify nor sound (`ctx.dmMuted`). A group's desktop notification reads "sandy in Gourd Club" (`ctx.dmTitle`).
- **`App`:**
  - Toasts for "You left …" / "You were removed from …" and for refusals.
  - The switcher lists groups by title; the people picker lists people only.
- **Typing names** already came from `TypingIndicator` ("bob and cara are typing…").

## Acceptance criteria
- [x] **Web:** picking several people creates a group; Add people from a 1-to-1 makes a new group; the members dialog works (add, owner-only remove, rename, mute, leave with confirm); sidebar rows and the group avatar; system notices; typing names; the toast and close when removed; muted groups stay silent.
- [x] **All suites pass;** `vite build` is clean.
- [x] **Sandbox, in two browsers** (sandy, bob; cara via script): make a group, rename it, add cara, and chat. Then mute, have bob leave, and remove a member, checking what each person sees.

## Evidence (2026-10-20)
| Acceptance criterion | Evidence |
|---|---|
| Web | `groupDms.test.jsx` (new, 7):<br>• Titles (name; "bob, cara and dee"; "bob and cara"; "Just you"; a pair's).<br>• PeoplePicker: locked bob, minimum 2, search, full at max with the note, unpick, the name trimmed, sends `{ members: ['bob','cara'], name: 'Gourd Club' }`.<br>• Members dialog: rows and Owner; Remove asks then calls with "cara"; Rename only when changed; Mute; Add people; the owner leaving sees "bob becomes the owner"; a non-owner sees no Remove; Add people is off at 10.<br>• The sidebar group row (title, "4 members", muted, unread, dimmed).<br>• DmPanel headers for a group (Members, "Message Gourd Club") and a pair (Add people, "Message @bob").<br>• A notice as `role=note` with no buttons, not an article, skipped by the up arrow.<br>• A muted conversation gives no attention.<br>`useDms.test.js` (+2): summary add / update and the title; created → opens; a notice is shown but doesn't notify, a group message does; every action's op; refusals kept only for group ops; `dm_left` drops it, closes it and calls `onLeft`. A group frame from cara doesn't take over `@cara` and counts unread for `c:9`. |
| All suites | Web 103 files, 811. `vite build` clean. Server unchanged since #193 (453) |
| Sandbox (:3005; sandy in one tab, bob in the other; both on the new build) | **sandy:** New message → Start a group → picked bob and cara (dee also offered), named "Gourd Club" → "Start a group (3 people)". It opened at once: header "Gourd Club · 3 members", the notice "sandy started the group", a new sidebar row.<br>**bob's tab**, live: the row "Gourd Club / sandy started the group, 1 unread". Opening it showed the notice and "Message Gourd Club". Typing → sandy saw "bob is typing"; "hi gourds" reached sandy.<br>**sandy's Members:** Add people offered only dee → "Add 1" → "sandy added dee", 4 members. Renamed "Squash Squad" → the notice, and bob's header updated. Remove dee → the confirm → "sandy removed dee", 3 members (my first click hit Cancel, which correctly removed nobody).<br>**bob's Members:** no Remove buttons, "(you)", sandy marked Owner; Mute → on. Leave group → "Leave Squash Squad? You won't see new messages…" → the toast "You left Squash Squad", the view closed and the row was gone. sandy saw "bob left" and 2 members.<br>**From the 1-to-1:** sandy's Add people opened "Start a group with bob" (bob locked, the private-messages note) → picked cara → a new group "bob and cara" opened. The 1-to-1 with bob stayed as it was.<br>**Not tried live:** being removed while watching (covered by the `dm_left` / `onLeft` test), and a muted group's desktop notification (covered by the notify test) |
