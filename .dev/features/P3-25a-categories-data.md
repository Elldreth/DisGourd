# P3-25a — Categories: data and API

- **Unit Type:** Implementation (child of P3-25)
- **Phase:** 3
- **State:** READY
- **Effort:** M
- **Depends on:** none (P3-25 design agreed)

## Scope
- **Migration v17:**
  - `channel_categories(id, space_id → spaces ON DELETE CASCADE, name TEXT NOT NULL, position INTEGER NOT NULL)`;
  - `channels.category_id` (→ channel_categories ON DELETE SET NULL) and `channels.position INTEGER NOT NULL DEFAULT 0`.
  - **Existing servers:** for each one, create "Text channels" (position 0) and "Voice channels" (position 1), put the text and voice channels in them in id order, and leave threads out.
- **Reads:** channel meta in GET /spaces (or the channels endpoint the app uses) gains `category` (id or null) and `position`, plus `categories: [{ id, name, position }]` per server. Lists are ordered: uncategorized first, then categories by position, channels by position.
- **Routes** (all need `manage_channels`; names 1–50 characters, trimmed):
  - `POST /spaces/:s/categories { name }` → appended at the end;
  - `PATCH /spaces/:s/categories/:id { name }`;
  - `DELETE /spaces/:s/categories/:id`: its channels become uncategorized, appended after the existing uncategorized ones in their order;
  - `PUT /spaces/:s/layout { categories: [id…], channels: [{ name, category: id|null }…] }`: the whole new order in one request. The server checks it lists exactly this server's categories and its non-thread channels, then rewrites positions in a transaction. This serves both drag and the Move menus.
- **New channels** go at the end of the category given in the create request (`category`), or by default the server's "Text channels" / "Voice channels" category if it still exists, otherwise uncategorized.
- **Templates:** new servers from a template get the two default categories, plus any the template names.
- **Live:** one `layout_changed { space }` gateway event to members after any category or layout change, and after channel create / delete; the app reloads that server's channel meta.

## Acceptance criteria
- [ ] Migration: an existing server with text, voice and thread channels gets the two categories, holding its text and voice channels in order; threads stay out; it's idempotent across restarts.
- [ ] Routes: create / rename / delete (channels kept, uncategorized, order kept); layout reorders categories and moves channels between them; a layout missing or adding a channel, or naming another server's category, is refused with 400; managers only (403 for members); positions come back contiguous.
- [ ] A new channel lands at the end of its category (given, or default); templates create the categories.
- [ ] `layout_changed` reaches the members (and not outsiders).
- [ ] All suites pass.
