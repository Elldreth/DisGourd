# P2-07 — Any emoji as a reaction (full picker from the message actions)

- **Unit Type:** Implementation
- **Phase:** 2, rank 4 (part 2)
- **State:** PLANNED
- **Effort:** S
- **Depends on:** P2-06 (EmojiPicker), P3-05 (MessageActions component)
- **Serialize with:** MessageList.jsx/MessageActions.jsx units
- **Requirement Source:** IMPROVEMENT-PLAN.md Phase 2 #4

## Scope
- The quick-reaction popover keeps the 8 defaults and adds a "+" that opens EmojiPicker. Picking an emoji sends `react`.
- The server trims emoji to 16 UTF-16 units (`server.js` `react` case). Verify that ZWJ sequences such as 🧑‍🤝‍🧑 or 👨‍👩‍👧‍👦 (11 units) and flags pass. If any common sequence exceeds 16, raise the cap to 32 *and* validate that it's a single grapheme (`Intl.Segmenter`) to block text abuse.

## Acceptance criteria
- [ ] React with 🫠 and 👨‍👩‍👧‍👦 from the picker: it persists in history and shows for other viewers.
- [ ] Server test (new or extended file): a 2-grapheme string like "ab" is rejected if grapheme validation was added.
- [ ] Keyboard path: focus the message, open actions, open React, then use the picker.

## Expected Areas of Change
`web/src/components/MessageActions.jsx`, and possibly `server/gateway/chat.js` plus a test.

## Working Set / Blast Radius
Small.
