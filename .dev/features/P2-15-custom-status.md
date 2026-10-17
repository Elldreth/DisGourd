# P2-15 — Custom status text (with optional emoji and expiry)

- **Unit Type:** Implementation
- **Phase:** 2, rank 8 (part 3)
- **State:** REVIEW
- **Effort:** S
- **Depends on:** P2-14
- **Requirement Source:** IMPROVEMENT-PLAN.md Phase 2 #8

## Scope
- Migration: `users.status_text TEXT` (max 80 characters), `users.status_emoji TEXT`, `users.status_expires_at INTEGER`.
- `PATCH /me { statusText, statusEmoji, statusExpiresIn: '30m'|'1h'|'4h'|'today'|null }`. Members and `presence` frames carry `statusText`/`statusEmoji`. An expired status is cleared lazily on read and on a 1-minute sweep.
- Client: "Set a custom status" in the P2-14 menu, with the emoji from EmojiPicker (P2-06) if it's available. The text shows under the name in MemberList and in the profile popover.

## Acceptance criteria
- [x] Server test: set the status; co-members get it; expiry clears it (fake timers or a past `expires_at`); text over 80 characters gives 400; markdown and HTML are stored literally and rendered as text.
- [x] Manual: the status shows for others and clears at expiry.

## Expected Areas of Change
The same files as P2-14, plus the status dialog component.

## Working Set / Blast Radius
~7 files.

## Evidence
Baseline: main at 10c9012 (after #93). Branch `claude/p2-15-custom-status`.

| Acceptance criterion | Evidence |
|---|---|
| Set; co-members get it | `server/tests/customStatus.test.js`: the text is trimmed. The co-member gets `presence { statusText, statusEmoji }` and `/members` carries both. Your own tabs get `my_status`. |
| Expiry clears it | A past `status_expires_at` is cleared on read (`/members`, `/me`). `sweepExpiredStatuses()` clears it, broadcasts `presence` with nulls and `my_status` to you, and then finds nothing more. "30m", "1h" and "4h" are within 5 s of expected. "today" with `tzOffset` 300 lands on the next local midnight (≤ 24 h ahead). |
| Over 80 characters gives 400 | 81 gives 400, 80 gives 200. Also: a non-emoji, two emojis, an unknown expiry ("2d") and a non-string text all give 400. |
| Markdown and HTML are stored literally and rendered as text | The server stores `**bold** <img src=x onerror=…>` as is. MemberList renders `👋 <b>hi</b> **there**` as text, with no `<b>` element (web test). |
| Manual: shows for others and clears at expiry | Sandbox, sandy and bob. Sandy used the real menu ("Set a custom status"), typed `Testing **status** <b>text</b>`, picked 🧪 in the real emoji picker (search, Enter; this didn't submit the form, and focus returned), chose "30 minutes", and saved. Her footer showed it, and bob's member list showed it **literally** (no `<b>` element). Then, in the **sandbox DB only**, the expiry was moved into the past: the 60 s sweep cleared it live in bob's view **38 s** later, and sandy's footer went back to "Online" by itself (`my_status`). |

Tests: server 216 (7 new). Web 426 (5 new). Build clean.

### Notes
- Others see your custom status only while you appear online, idle or DND. It's hidden while invisible (or offline), so it can't give an invisible user away. You always see your own.
- "Today" is the next midnight in the browser's timezone (sent as `tzOffset`).
- There's no profile popover in the app yet, so the status shows in the member list and your footer. Revisit if a profile card is added.
- `EmojiPicker` is reused as is. Its Enter/Esc handling keeps the surrounding form and dialog safe.
