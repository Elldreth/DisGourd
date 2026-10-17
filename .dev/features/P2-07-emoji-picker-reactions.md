# P2-07 — Any emoji as a reaction (full picker from the message actions)

- **Unit Type:** Implementation
- **Phase:** 2, rank 4 (part 2)
- **State:** REVIEW (PR open)
- **Effort:** S
- **Depends on:** P2-06 (EmojiPicker), P3-05 (MessageActions component)
- **Serialize with:** MessageList.jsx/MessageActions.jsx units
- **Requirement Source:** IMPROVEMENT-PLAN.md Phase 2 #4

## Scope
- The quick-reaction popover keeps the 8 defaults and adds a "+" that opens EmojiPicker. Picking an emoji sends `react`.
- The server trims emoji to 16 UTF-16 units (`server.js` `react` case). Verify that ZWJ sequences such as 🧑‍🤝‍🧑 or 👨‍👩‍👧‍👦 (11 units) and flags pass. If any common sequence exceeds 16, raise the cap to 32 *and* validate that it's a single grapheme (`Intl.Segmenter`) to block text abuse.

## Acceptance criteria
- [x] React with 🫠 and 👨‍👩‍👧‍👦 from the picker: it persists in history and shows for other viewers.
- [x] Server test (new or extended file): a 2-grapheme string like "ab" is rejected if grapheme validation was added.
- [x] Keyboard path: focus the message, open actions, open React, then use the picker.

## Expected Areas of Change
`web/src/components/MessageActions.jsx`, and possibly `server/gateway/chat.js` plus a test.

## Working Set / Blast Radius
Small.

## Evidence
| Check | Result |
|---|---|
| Emoji lengths (emojibase data the picker uses) | every emoji is 1 grapheme, longest 14 UTF-16 units (subdivision flags); skin-toned couples outside the data reach 15. The old 16-unit `slice` fitted them but accepted any text ("hello…" became a reaction) and could cut a sequence in half |
| `server/tests/reactions.test.js` (13): 🫠, 👨‍👩‍👧‍👦, 👩🏻‍❤️‍💋‍👨🏼 (15 units), 🏴󠁧󠁢󠁥󠁮󠁧󠁿, 🇺🇸, 1️⃣ accepted, broadcast to the other viewer and in the stored history; "ab", "👍👍", "🔥lol", a sentence, blank and a number refused; surrounding spaces trimmed | pass (the 4 text / multi-emoji cases failed first) |
| `MessageActions.test.jsx` (4): 8 quick reactions + "More reactions"; a full-picker pick sends any emoji (🫠); keyboard only (End to "More reactions", Enter, search, Enter); Esc closes | pass (failed first) |
| Full suites | web 285/285, server 90/90, build ok |
| Sandbox, real key presses: focus the last message, Enter (actions), ↓ Add reaction, Enter, End -> "More reactions", Enter (picker opens above the message, inside the window, search focused), type "melting", Enter -> 🫠 on the message | pass |
| Sandbox, mouse: React -> + -> "family: man, woman, girl, boy" -> 👨‍👩‍👧‍👦. bob's separate connection received both `reaction` frames; both still shown after a reload; no console errors | pass |

## Implementation notes
- Server: `parseReactionEmoji` in `validate.js`: trimmed, at most 32 UTF-16 units, exactly one grapheme (`Intl.Segmenter`), and containing an `Extended_Pictographic` / regional-indicator / keycap character. Anything else is refused, not trimmed.
- Client: `ReactionPicker` gains a ninth item, "More reactions" (+), in the same arrow-key menu. It opens `EmojiPicker` in a portal with fixed positioning beside the strip (above if there's room, clamped to the window) so the scrolling message list can't clip it; on touch it opens as a bottom sheet. Picks are added to the picker's Recent row.

## Not verified
- The touch bottom-sheet variant on a real phone.
- Other browsers' grapheme segmentation (the server decides; Node's ICU).
