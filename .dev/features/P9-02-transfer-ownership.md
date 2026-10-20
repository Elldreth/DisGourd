# P9-02 — Hand a server to a new owner

- **Unit Type:** Implementation
- **Phase:** 9
- **State:** COMPLETE (merged #180)
- **Starting baseline:** main at c145331 (#179 merged)
- **Effort:** S–M (no migration)
- **Depends on:** P2-21 (roles), P5-04 (Server settings › Overview)
- **Requirement Source:** the follow-up list (2026-10-20). Design agreed with the owner on 2026-10-20:
  - **Who:** the owner picks any member of the server.
  - **Confirming:** no acceptance step. The owner confirms by typing the server's name, and ownership moves at once.
  - **The old owner** becomes an Admin.

## Today
- `spaces.owner_id` is the owner, and `resolveAccess` treats that user as above every role. `space_members.role` still carries the legacy 'owner' / 'admin' / 'member' tier.
- **The seeded "Admin" role** (`seededAdminId`) can be renamed or deleted on the Roles screen.

## Scope
- **`POST /spaces/:s/transfer { user, confirm }`:** the owner only; `confirm` must equal the server's name.
  - **Refused:** with 400 for yourself, 404 for someone who isn't a member, and 403 for anyone but the owner.
  - **In one transaction:** it sets `spaces.owner_id` to the new owner and swaps the legacy tiers: new → 'owner', old → 'admin'. It gives the old owner the seeded Admin role. If that role was renamed or deleted, they get the highest non-default role instead; if there is none, no role, and a note says so.
  - **Logged** in the moderation log as `ownership_transfer` (old → new).
  - **Who's told:** members get `members_changed` and `space_updated`, and the new owner gets `ownership_received { space, from }`.
- **App:**
  - **Where:** Server settings › Overview's danger zone, for the owner only, gets "Transfer ownership…" above "Delete server".
  - **The dialog:** choose a member (searchable, everyone except you), type the server's name to confirm, then "Transfer". The text says plainly that it happens at once, that you'll become an Admin, and that only the new owner can give it back.
  - **Afterwards:** the old owner's window closes, since their settings access changes, with a toast: "You handed Tx Check to bob." The new owner gets a toast: "sandy made you the owner of Tx Check."
  - **The log** reads "sandy handed the server to bob".

## As built
- **`db.transferOwnership`** runs in one transaction. The new owner's own roles are left alone, and the old owner's other roles stay.
- **The response** is `{ owner, yourRole }`. A bot can't receive a server (400), and the match on the server's name is case-sensitive.
- **The app:**
  - The danger zone reads "Hand the server to another member. You'll become an Admin." with **Transfer ownership…** above the delete text.
  - The dialog's member list is a searchable radio group (everyone but you and the bot), and its button reads "Transfer to bob".
  - Afterwards the Server settings window closes. `useSpaces` gains a small `notice` for App's toasts ("You handed Tx Check to bob." / "sandy made you the owner of Tx Check."), and both sides reload.
- **The log** reads "sandy handed the server to bob", with an Ownership filter.

## Acceptance criteria
- [x] Server: owner only; the confirm name must match; refusals; after the move the new owner has every action and the old one is an Admin (positions and access correct); Admin-role fallbacks; logged; frames.
- [x] Web: the danger-zone item (owner only), the dialog's member picker and confirmation, the toasts, the log sentence.
- [x] All suites pass; `vite build` is clean.
- [x] Sandbox: sandy hands a server to bob; bob sees the toast and the owner's settings; sandy sees Admin abilities only; bob hands it back.

## Evidence (2026-10-20)
| Acceptance criterion | Evidence |
|---|---|
| Server | `transfer-ownership.test.js` (4):<br>• **Refusals:** a non-owner gets 403; the wrong case or an empty name 400; a non-member or unknown user 404; yourself 400.<br>• **A handover:** `{ owner: 'bob', yourRole: 'Admin' }`. Bob is now the owner; sandy isn't, holds Admin (delete others' messages yes, manage roles no) and sits below bob. The legacy tiers become owner / admin. Bob gets `ownership_received { from: 'sandy' }` and members get `members_changed`. It's logged with the role. Sandy can no longer transfer, and bob can hand it back.<br>• **Admin deleted:** the old owner gets the highest remaining role.<br>• **No roles at all:** `yourRole: null`, and the move still happens.<br>Server suites: 49 files, 433 |
| Web | `Transfer.test.jsx` (5): owner-only button in the danger zone; the picker lists bob and cara (not me, not the bot) and searches ("CA" → cara, "zz" → "No members match."); Transfer stays disabled until a member is picked and the name matches exactly ("tx" isn't enough), then calls `transferServer('Tx', 'bob', 'Tx')`, closes and reports `onTransferred('bob')`; a refusal shows in the dialog; the log sentence. Web suites: 101 files, 785; `vite build` clean |
| Sandbox (:3005, restarted on this branch; sandy and bob in two tabs) | Sandy → Tx Check → Server settings → Overview → Transfer ownership… → bob (the list offered bob and cara) → typed "Tx Check" → "Transfer to bob". Sandy's toast: "You handed Tx Check to bob."; bob's toast: "sandy made you the owner of Tx Check."; the member list showed bob OWNER and sandy ADMIN, and bob's rail now showed the open-reports badge. API: sandy `owner: false`, no manage_roles, delete_others yes, and her transfer attempt → 403. Bob handed it back (200, `yourRole: 'Admin'`), and the log shows both moves. Then bob's tier was set back to member, so the sandbox roles are exactly as before (sandy owner [8], bob member [19], cara member []) |
