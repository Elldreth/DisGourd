# P9-02 — Hand a server to a new owner

- **Unit Type:** Implementation
- **Phase:** 9
- **State:** READY
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

## Acceptance criteria
- [ ] Server: owner only; the confirm name must match; refusals; after the move the new owner has every action and the old one is an Admin (positions and access correct); Admin-role fallbacks; logged; frames.
- [ ] Web: the danger-zone item (owner only), the dialog's member picker and confirmation, the toasts, the log sentence.
- [ ] All suites pass; `vite build` is clean.
- [ ] Sandbox: sandy hands a server to bob; bob sees the toast and the owner's settings; sandy sees Admin abilities only; bob hands it back.
