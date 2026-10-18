# P3-25b — Categories in the channel list

- **Unit Type:** Implementation (child of P3-25)
- **Phase:** 3
- **State:** PLANNED (READY once P3-25a merges)
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
- [ ] Web: the order and grouping come from the meta; uncategorized first; collapse hides quiet channels but keeps the current and mentioned ones, and is remembered; manager-only controls; Move up / down / to send the right layout; delete confirmation; keyboard use of the headings and menus.
- [ ] All web tests pass; `vite build` clean.
- [ ] Sandbox: create a category, move channels into it by menu, collapse it; a second user sees the change live.
