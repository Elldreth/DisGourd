# P3-25 — Channel categories (Container: a–d)

- **Unit Type:** Container (not implemented directly)
- **Phase:** 3
- **State:** COMPLETE (a–d merged, #142, #145, #146, #147)
- **Effort:** L in total: a M, b M, c S–M, d M
- **Depends on:** P2-21 (roles and channel overrides), P3-15 (server templates)
- **Requirement Source:** the user, 2026-10-18 ("channel categories"). Design agreed with the user on 2026-10-18:
  1. **Discord-style.** Named categories hold both text and voice channels, in an order the owner sets. Channels outside any category sit at the top. Existing servers get two categories, "Text channels" and "Voice channels", holding what they have now, so nothing looks different until someone changes it.
  2. **Arranging by drag, plus a keyboard menu.** Drag channels within and between categories, and drag categories to reorder. Channels and categories also get "Move up", "Move down" and "Move to category…" in their menus, which covers keyboards and phones.
  3. **Permissions are copied, not synced.** A category can have role overrides (who can see and post). A channel created in it, or moved into it, starts with a copy, which can then be changed per channel. There's no live syncing.
  4. **Collapsing hides quiet channels.** A collapsed category hides its channels except the one you're in and any with unread mentions. It's remembered per person on that device.

## Today (2026-10-18, main at #139)
- **Storage:** `channels` has no order column; the list is `ORDER BY id`. ChannelList shows fixed "Text channels" and "Voice channels" sections. Threads are hidden child channels (type 'thread').
- **Permissions:** `channel_role_overrides(channel_id, role_id, view, post)`, written by ChannelSettingsDialog (P2-21c).
- **Live updates:** `channel_created` / `channel_deleted` go to members over the gateway. There's no event for an update or reorder; topics and the 18+ flag reload via GET /spaces.
- **Templates:** `TemplatePicker.jsx` and the server templates create channel sets.

## Children (one PR each, in order)
| Unit | What | Working set |
|---|---|---|
| P3-25a | Data and API: categories, channel order, moves, live updates; existing servers and templates | migrations (v17), db/index.js, routes/spaces.js, gateway delivery, server templates, new tests |
| P3-25b | Channel list: categories, collapse, create / rename / delete, keyboard Move up / down / to | ChannelList.jsx, a small CategoryDialog, useSpaces (or wherever channel meta loads), tests |
| P3-25c | Drag and drop for channels and categories (mouse; phones use the menus from b) | ChannelList.jsx, a small drag hook, tests |
| P3-25d | Category permissions, copied to channels created in or moved into a category | migrations (v18) or reuse, roles route / ChannelSettingsDialog (category mode), db copy on create / move, tests |

## Decisions to keep
- Managing categories needs the same permission as managing channels (`manage_channels`, i.e. today's `canManage`).
- Deleting a category moves its channels to the uncategorized top, keeping their order; it never deletes channels.
- Positions are whole numbers rewritten in a transaction on each move, so there are no gaps or ties. A reorder is one request with the new order, and the server checks it covers exactly that server's channels and categories.
- Threads are never categorized; they stay under their parent channel.
