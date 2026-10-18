# P2-19a — Custom server emoji: storage and management API (server)

- **Unit Type:** Implementation (child of P2-19)
- **Phase:** 2
- **State:** COMPLETE (merged in #110, 2026-10-17)
- **Effort:** S–M
- **Depends on:** P1-01 (migrations), P1-04 (uploads)
- **Serialize with:** anything touching `server/db/index.js`, `server/routes/spaces.js`, `server/routes/uploads.js`

## Scope
- **Migration 10:** `space_emoji(id, space_id REFERENCES spaces(id) ON DELETE CASCADE, name, url, created_by, created_at, UNIQUE(space_id, name))`.
- **Permission** `manage_emoji` (default rank 2: owner and admins), in `DEFAULT_PERMISSIONS` and editable like the others.
- **Rules:** names are `[a-z0-9_]{2,32}` (lower-cased on the way in); the image is an upload already made through `POST /uploads` (png, jpg, gif, webp), at most **256 KB**; at most **50** emoji per server.
- **API:**
  - `GET /spaces/:s/emoji` (members) → `[{ id, name, url, createdBy }]`, by name.
  - `POST /spaces/:s/emoji { name, url }` (manage_emoji) → 201 with the emoji; 400 bad name / not an upload / not an image, 409 name taken or cap reached, 413 over 256 KB.
  - `DELETE /spaces/:s/emoji/:name` (manage_emoji) → 200, 404 if absent.
  - Both changes broadcast `space_updated`, and `GET /spaces` includes each server's `emoji` list so clients can render `:name:` (P2-19b).
- Deleting the server deletes its emoji rows (cascade). The upload files stay, as other uploads do.

## Acceptance criteria
- [x] `server/tests/emoji.test.js`: an admin adds an emoji from an upload (201, listed, `space_updated` to members, present in `GET /spaces`); a member gets 403; a bad name, a non-upload URL and a non-image get 400; a duplicate name 409; an image over 256 KB 413; the 51st emoji 409; delete works and 404s when absent; deleting the server removes its emoji; a server can't see another server's emoji.
- [x] Every existing server test still passes (the migrations test with migration 10).

## Expected Areas of Change
`server/db/migrations.js`, `server/db/index.js`, `server/routes/spaces.js`, `server/routes/uploads.js` (export a path resolver), new `server/tests/emoji.test.js`.

## Working Set / Blast Radius
~5 files, small. The only risk is path handling when checking an upload's size: resolve inside `UPLOADS_DIR` only, as the GET route does.

## Implementation notes
- `uploadFilePath(url)` in `routes/uploads.js` maps one of our `/uploads/<token>/<name>` URLs to its file, with the same normalisation and inside-the-directory check the GET route uses; anything else is null (so `https://…` and `/uploads/../…` are refused).
- The emoji routes live in `routes/spaces.js` under `/spaces/:s/emoji`, after the membership check. The size (256 KB) and type (png, jpg, gif, webp) checks happen there; names, uniqueness and the 50 cap are in `db.addSpaceEmoji` (a transaction).
- Names are lower-cased on the way in, so `Party_Gourd` and `PARTY_GOURD` are the same emoji.
- `GET /spaces` now carries `emoji: [{ id, name, url }]` per server, and the client's permissions dialog lists "Manage server emoji" (the one client change here; rendering and the picker are P2-19b).
- The migration adds no `idx_` index: the `UNIQUE (space_id, name)` constraint's own index serves the lookups.

## Evidence (2026-10-17)
| Acceptance criterion | Evidence |
|---|---|
| Admin adds from an upload; listed; `space_updated`; in `GET /spaces` | `emoji.test.js` "an admin adds an emoji from an upload…": 201 with `{ name: 'party_gourd', url, createdBy }`, the member's gateway got `space_updated`, the list and `GET /spaces` (with `permissions.manage_emoji: 2`) show it |
| Permission | "only people with manage_emoji may add or remove…": member 403 on POST and DELETE, outsider 403 on GET; after the owner sets `manage_emoji` to 1 a member can add |
| Validation | "names, URLs and files are checked": too short, spaces, too long, an external URL, a `/uploads/../` URL and a missing upload are 400; a `.txt` upload 400; a 300 KB PNG 413; a duplicate name (either case) 409 |
| Cap | "at most 50 emoji per server": the 51st is 409 with a message naming 50 |
| Delete and isolation | "delete removes one; a second delete is 404; servers never see each other's emoji" |
| Cascade | "deleting the server removes its emoji rows" |
| Full suite | `npx jest`: 25 suites, 249 tests (6 new), all passing; the migrations test unchanged (no new `idx_` index) |
| Sandbox (:3005, sandbox DB only) | The sandbox DB upgraded to `user_version` 10 on start. As sandy (owner of "Smoke Test"): a 1×1 PNG upload, then `POST …/emoji { name: 'gourd' }` → 201; a bad name → 400; bob (not a member) → 403; the list and `GET /spaces` carried the emoji; DELETE → 200, again → 404 |
