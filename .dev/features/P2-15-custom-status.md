# P2-15 — Custom status text (with optional emoji and expiry)

- **Unit Type:** Implementation
- **Phase:** 2, rank 8 (part 3)
- **State:** PLANNED
- **Effort:** S
- **Depends on:** P2-14
- **Requirement Source:** IMPROVEMENT-PLAN.md Phase 2 #8

## Scope
- Migration: `users.status_text TEXT` (max 80 characters), `users.status_emoji TEXT`, `users.status_expires_at INTEGER`.
- `PATCH /me { statusText, statusEmoji, statusExpiresIn: '30m'|'1h'|'4h'|'today'|null }`. Members and `presence` frames carry `statusText`/`statusEmoji`. An expired status is cleared lazily on read and on a 1-minute sweep.
- Client: "Set a custom status" in the P2-14 menu, with the emoji from EmojiPicker (P2-06) if it's available. The text shows under the name in MemberList and in the profile popover.

## Acceptance criteria
- [ ] Server test: set the status; co-members get it; expiry clears it (fake timers or a past `expires_at`); text over 80 characters gives 400; markdown and HTML are stored literally and rendered as text.
- [ ] Manual: the status shows for others and clears at expiry.

## Expected Areas of Change
The same files as P2-14, plus the status dialog component.

## Working Set / Blast Radius
~7 files.
