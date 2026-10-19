# P3-25a — Categories: data and API

- **Unit Type:** Implementation (child of P3-25)
- **Phase:** 3
- **State:** COMPLETE (merged #142)
- **Starting baseline:** main at 202ab63 (#141 merged)
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
- [x] Migration: an existing server with text, voice and thread channels gets the two categories, holding its text and voice channels in order; threads stay out; it's idempotent across restarts.
- [x] Routes: create / rename / delete (channels kept, uncategorized, order kept); layout reorders categories and moves channels between them; a layout missing or adding a channel, or naming another server's category, is refused with 400; managers only (403 for members); positions come back contiguous.
- [x] A new channel lands at the end of its category (given, or default); templates create the categories.
- [x] `layout_changed` reaches the members (and not outsiders).
- [x] All suites pass.

## Implementation notes
- **Live updates reuse `space_updated`**, which the app already reloads on, instead of a new `layout_changed` event. Category and layout changes therefore show live in today's list before P3-25b. Creating a channel also sends it, so the new channel's place arrives.
- **Permission:** `create_channel`, the same as making channels.
- **Hidden channels:** the layout lists only the channels the arranger can see. Channels they can't see keep their category and follow the listed ones in it, in their old order (so a manager without access to a private channel can still rearrange).
- **The default category for a new channel is found by name** ("Text channels" / "Voice channels"). Once renamed, new channels without a `category` go to the top. P3-25b sends `category` explicitly from a heading's +.
- Templates name no extra categories, so new servers get the two defaults.

## Evidence (2026-10-18)
| Acceptance criterion | Evidence |
|---|---|
| Migration | `categories.test.js`: a v16 database with b-general, voice-1, a-random and a thread → "Text channels" (0) with b-general 0, a-random 1 (creation order), "Voice channels" (1) with voice-1 0, and the thread uncategorized; running again adds nothing. `db-migrations.test.js` lists `idx_categories_space` |
| Routes | create (trimmed "Games", position 2), rename, 404 for unknown ids and other servers' ids; 400 for blank or more than 50 characters; member 403; delete keeps the channels (minecraft joins the top after "loose"). Layout reorders Music / Voice / Text and moves channels across; positions 0, 1, 2; refused for a missing or duplicated category, a missing / extra / duplicated channel, another server's category, or a non-array; member 403. An unseen private channel ("secret") stays in Text channels after the listed ones |
| New channels | end of the asked category; default by type (news → Text 3rd, stage → Voice 2nd); with "Text channels" renamed, to the top; a template server ("study") has general / resources / questions in Text 0–2 and study-room in Voice 0 |
| Live | the member gets `space_updated` for Sorted; the outsider doesn't |
| Suites | Server: 345 tests (`api.test.js` meta now includes category / position). Web: 621, unchanged |
| Sandbox | Restarted on this branch (migration on the sandbox copy): Tx Check has Text channels (general, random, history, made-offline, second-offline, staff at 0–5) and Voice channels (lounge 0); the list looks as before. Via the API as sandy: create "Test category" (id 9, position 2), layout staff → top and lounge → Test category: 200, and the open channel list reloaded by itself to staff, general, … , lounge. Restored the layout and deleted the category; the list is back to general … staff, lounge |
