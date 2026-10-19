# P3-25b — Categories in the channel list

- **Unit Type:** Implementation (child of P3-25)
- **Phase:** 3
- **State:** REVIEW
- **Starting baseline:** main at 31cf381 (#144 merged)
- **Effort:** M
- **Depends on:** P3-25a

## Scope
- **Layout:** ChannelList shows the uncategorized channels at the top, then each category as a heading (name and a collapse chevron), with its text and voice channels in order. Voice channels keep their participants underneath. The fixed "Text channels" / "Voice channels" sections are gone; existing servers look the same because a got them those categories.
- **Collapse:** click the heading (or Enter / Space; `aria-expanded`). A collapsed category hides its channels except the one you're in and any with unread mentions. Remembered per server and category in localStorage (`dg.collapsed`), wrapped in try/catch.
- **Managers:**
  - "+ Create category" in the server menu;
  - each heading has a ⋯ menu: Rename, Move up, Move down, Delete (with a confirmation saying the channels are kept);
  - each channel's menu or settings gains "Move up", "Move down" and "Move to category…" (a small picker).
  - Every move sends the new layout via `PUT /layout`.
- **Create channel:** the + on a category heading creates the channel in that category.
- **Live:** `layout_changed` reloads that server's channel meta.

## Acceptance criteria
- [x] Web: the order and grouping come from the meta; uncategorized first; collapse hides quiet channels but keeps the current and mentioned ones, and is remembered; manager-only controls; Move up / down / to send the right layout; delete confirmation; keyboard use of the headings and menus.
- [x] All web tests pass; `vite build` clean.
- [x] Sandbox: create a category, move channels into it by menu, collapse it; a second user sees the change live.

## Implementation notes
- **The arranging logic is plain functions in `web/src/channelLayout.js`:** `buildGroups`, `layoutBody`, `moveChannel` (crosses into the next group at an edge), `moveChannelTo`, `moveCategory`, `visibleWhenCollapsed`, and `loadCollapsed` / `saveCollapsed` (`dg.collapsed` in localStorage, wrapped in try/catch).
- **Groups are built from the `channels` / `voiceChannels` names,** with each one's category and position from `channelMeta`. A channel without that info (older data) goes to the top, so nothing disappears.
- **Where things live:**
  - "Create channel" (at the top) and "Create category" are in the server menu. A new category is made as "New category" and opens straight into renaming.
  - Each category heading has + (create a channel there, with a Text / Voice choice; Voice by default in an all-voice category) and ⋯ (Rename, Move up, Move down, Delete category, with a confirmation that the channels are kept).
  - A channel's Move up / Move down and Category are in its settings dialog ("Place in the channel list"); moves apply at once.
- **Members don't see empty categories.**
- **Live:** the server's `space_updated` (from P3-25a) reloads everyone's list.

## Evidence (2026-10-18)
| Acceptance criterion | Evidence |
|---|---|
| Web | `channelLayout.test.js` (6): grouping, with no-info channels at the top; the layout body; moves within, across edges, and refused at the very top; move to a category or the top; category moves never above the top group; what stays visible when collapsed; remembered per server, surviving bad storage. `ChannelCategories.test.jsx` (5): headings in order with "rules" above them, the empty category hidden from members, no manager controls for members; collapsing keeps the current (news) and mentioned (memes) channels, hides general, `aria-expanded`, remembered across remounts; + in Voice channels defaults to Voice and calls `onCreateChannel('game-night', 'voice', 2)`; the ⋯ menu's Move up sends categories [2, 1, 3], there's no Move down on the last category, Rename sends 'Archive', and Delete confirms "Its channels are kept" and deletes; the server menu creates a category; the settings dialog's Move up sends news, general, memes, and Category → top sends rules, news. `touchTargets.test.jsx`: the category heading and its + are tap-sized |
| Suites | Web: 76 files, 635 tests. `vite build` clean. Server unchanged (P3-25a) |
| Sandbox | Tx Check as sandy: Text channels (general, random 18+, history, made-offline, second-offline, staff) and Voice channels (lounge). Server menu → Create category → renamed to "Games" (bob doesn't see it while empty). #staff → settings → Category "Games": sandy and bob (another tab, live) both show "Games: staff". On bob's tab, collapsing Text channels left only #general (his channel), with the unread-but-unmentioned channels hidden; stored `{"Tx Check":[7]}`; expanded again. Restored afterwards (staff back at the end of Text channels, Games deleted); both tabs match the original |
