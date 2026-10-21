# P11-04 — Upload quotas, cleanup with their messages, sandboxed serving

- **Unit Type:** Implementation (child of P11-00)
- **Phase:** 11
- **State:** READY
- **Effort:** M
- **Depends on:** none
- **Serialize with:** none (`routes/uploads.js` and the delete paths in `db/index.js` aren't touched by the other P11 units)
- **Requirement Source:** P11-00 findings H2 (uploads) and M4.

## Problem
- Any signed-in member can upload 25 MB as often as they like (`server/routes/uploads.js:79-147`). There's no per-user or total cap, so the cloud volume fills.
- Files are public by URL with a year-long immutable cache, and they stay after their message or DM is deleted (`server/db/index.js:1787-1793`, `1588`). A deleted private photo is still served to anyone who has the link.

## Scope
- **Quotas:**
  - `UPLOAD_QUOTA_BYTES_PER_DAY` per user (default 500 MB; site admins exempt) and `UPLOADS_MAX_TOTAL_BYTES` (default off; when set, uploads are refused with 507 once the uploads folder reaches it).
  - Usage is counted in a small `uploads` table (`token, user_id, bytes, created_at`), written when an upload finishes.
  - Refusals say so plainly: "You've uploaded 500 MB today; try again tomorrow".
- **Cleanup:**
  - When a channel message or DM is deleted (by its author, a moderator, a ban's "delete messages", a deleted channel or server, or a left conversation that disappears), remove the upload folders it referenced that no other message, avatar, server icon or emoji still uses. Do this after the transaction, best-effort, logged.
  - A daily sweep removes upload folders that nothing references and that are older than 24 hours (abandoned uploads, cancelled sends). It skips `.previews`.
- **Serving** (`/uploads/...`):
  - Add `Content-Security-Policy: default-src 'none'; sandbox` and `Cross-Origin-Resource-Policy: same-origin`.
  - Change the cache to `private, max-age=86400`, so a deleted file leaves shared caches within a day. `/media/preview` keeps its own headers.
- **The app:** a 413/507/429 from `/uploads` shows its message in the composer (already true for 413; check the others).

## Acceptance criteria
- [ ] AC-1: a user over the daily quota gets 429 with the message; another user can still upload.
- [ ] AC-2: deleting a message with an attachment removes the file (GET answers 404), unless another message uses the same URL.
- [ ] AC-3: an avatar, server icon or emoji upload is never removed while it's in use.
- [ ] AC-4: the sweep removes an unreferenced folder older than a day and leaves a fresh one alone.
- [ ] AC-5: `/uploads` responses carry the CSP sandbox, CORP and private cache headers; images, video and audio still show inline in the app (sandbox doesn't affect `<img>` / `<video>`).
- [ ] AC-6: both suites pass.

## Expected Areas of Change
`server/routes/uploads.js`, `server/db/migrations.js` (a new version for `uploads`), `server/db/index.js` (delete paths call a cleanup hook), a new `server/uploadsGc.js`, `server/server.js` (start the sweep, unref'd, not under test), the README (the new env vars), tests (`server/tests/uploads-quota.test.js`, `uploads-cleanup.test.js`).

## Not in scope
Signed or expiring upload URLs, and a separate user-content origin (P11-00 Discovered Work). Re-encoding images or stripping EXIF (worth a later packet: phone photos carry GPS).
