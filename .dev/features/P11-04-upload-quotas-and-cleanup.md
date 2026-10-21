# P11-04 — Upload quotas, cleanup with their messages, sandboxed serving

- **Unit Type:** Implementation (child of P11-00)
- **Phase:** 11
- **State:** REVIEW (build order 7 in P11-00)
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
- **Cloudflare's edge cache:** Cloudflare caches `.jpg`, `.png`, `.gif`, `.mp4` and similar by default, and `/uploads` says `public, max-age=31536000, immutable`, so a deleted photo can still be served from Cloudflare's edge. The `private` cache header below stops new copies. After a deploy, purge the cache once (Cloudflare dashboard → Caching → Purge everything, or by prefix `/uploads/`). Until this lands, the Cache Rule in P11-00 ("Cloudflare settings to do now") bypasses the cache for `/uploads/*`.
- **Serving** (`/uploads/...`):
  - Add `Content-Security-Policy: default-src 'none'; sandbox` and `Cross-Origin-Resource-Policy: same-origin`.
  - Change the cache to `private, max-age=86400`, so a deleted file leaves shared caches within a day. `/media/preview` keeps its own headers.
- **The app:** a 413/507/429 from `/uploads` shows its message in the composer (already true for 413; check the others).

## Acceptance criteria
- [x] AC-1: a user over the daily quota gets 429 with the message; another user can still upload.
- [x] AC-2: deleting a message with an attachment removes the file (GET answers 404), unless another message uses the same URL.
- [x] AC-3: an avatar, server icon or emoji upload is never removed while it's in use.
- [x] AC-4: the sweep removes an unreferenced folder older than a day and leaves a fresh one alone.
- [x] AC-5: `/uploads` responses carry the CSP sandbox, CORP and private cache headers; images, video and audio still show inline in the app (sandbox doesn't affect `<img>` / `<video>`).
- [x] AC-6: both suites pass.
- [ ] AC-7 (owner, live): after the deploy, `curl -sI https://<host>/uploads/<a real file>` shows `cf-cache-status: BYPASS` or `DYNAMIC` (not `HIT`).

## As built
- **Migration v32:**
  - An `uploads` table (`token, user_id, bytes, created_at`, indexed by user and time).
  - An `upload_gc_queue`.
  - `AFTER DELETE` triggers on `messages` and `dm_messages` that queue the deleted row's `attachments` and `attachment_url`. Triggers also fire for FK cascades, so channel, server and conversation deletes are covered without touching each delete path.
- **`server/uploadsGc.js`** (new):
  - **Quota:** `usedToday` over the last 24 h, `recordUpload`, and `quotaBytes()` / `maxTotalBytes()`, read from the environment on each request.
  - **`totalBytes()`:** the uploads folder's size, counted on first use, kept up to date on upload and removal, and re-counted by the sweep.
  - **`referencedTokens()`:** every upload token in message and DM `attachments` / `attachment_url`, avatars (`avatar_url`, `avatar_original`), server icons (`icon_url`, `icon_original`), `space_emoji.url` and `imagine_jobs.source_url`.
  - **`processQueue()`** (every 30 s): removes queued folders nothing references, logging `[uploads] Removed N …`.
  - **`sweep()`** (60 s after start, then daily): removes token folders (`^[a-f0-9]{18}$`) older than a day that nothing references. It skips `.previews` and other names, and drops `uploads` rows older than a week.
  - `start()` runs only from `server.js` when it's the main module, so tests never start timers.
- **`POST /uploads`:**
  - **Total cap:** 507 "The server's upload space is full…" when `totalBytes() + Content-Length` reaches `UPLOADS_MAX_TOTAL_BYTES`.
  - **Daily quota** (site admins exempt): 429 "You've uploaded N MB today, the most for one day. Try again tomorrow." It's checked up front from `Content-Length` and again while the body streams.
  - Each finished upload is recorded.
- **`GET /uploads/...`:** adds `Content-Security-Policy: default-src 'none'; sandbox` and `Cross-Origin-Resource-Policy: same-origin`. `Cache-Control` changes to `private, max-age=86400`.
- **Web:** no change. `api.uploadFile` already shows the server's `error` for any status, and the quota is refused before the body is read, so the message arrives intact.
- **README:** `UPLOAD_QUOTA_BYTES_PER_DAY` and `UPLOADS_MAX_TOTAL_BYTES` in the table, and two security notes.
- **`db-migrations.test.js`** lists the new index.

## Verification Evidence
| Acceptance Criterion | Status | Verification Type | Evidence |
|---|---|---|---|
| AC-1 | Verified | Jest `uploads-quota-cleanup.test.js` + sandbox | Quota 1,000 B: 600 → 201, then another 600 → 429 with the message; another user → 201; a site admin → exempt; total cap → 507. Sandbox (quota 2 MB): as cara, 1.2 MB → 201, then another 1.2 MB → 429 "You've uploaded 2 MB today, the most for one day. Try again tomorrow." |
| AC-2 | Verified | Jest + sandbox | Message delete → 404 for its file, while a URL shared with another message stays. A DM deleted by its author and a deleted channel (cascade) remove theirs too. Sandbox: cara's message with two files deleted through the gateway → both 404 within the 30 s timer |
| AC-3 | Verified | Jest | An avatar, server icon and emoji also attached to a deleted message stay (200) |
| AC-4 | Verified | Jest | A two-day-old unreferenced folder goes; a fresh one, a two-day-old referenced one, and `.previews` stay |
| AC-5 | Verified | Jest + sandbox + app | Headers checked in the test and on the sandbox (`default-src 'none'; sandbox`, `same-origin`, `private, max-age=86400`). In the app, #random's generated image and the avatars still show, and a cache-busted reload of an upload decodes at 1024×1024 |
| AC-6 | Verified | Jest, Vitest | Server 61 suites / 546 tests; web 107 files / 844 tests |
| AC-7 | Owner, live | After deploying | `curl -sI https://disgourd.<domain>/uploads/<file>` should show `cf-cache-status: BYPASS` (the owner's cache rule) and `cache-control: private, max-age=86400` |

The sandbox DB was migrated to v32 by this branch. A copy from before is at `%TEMP%/disgourd-sandbox-pre-v32.db`.

## Discovered Work (not done here)
- **Files from before this release** aren't in `uploads`, so they don't count toward anyone's quota (only new uploads do), and the first sweep removes any old folder nothing references. On the live server that's what you'd want after the fresh start; on an old install it also removes long-orphaned files.
- **Deleted files can stay in a browser's cache** for up to a day (`private, max-age=86400`).
- **EXIF:** stripping location data from photos is still open (P11-00 Discovered Work).

## Expected Areas of Change
`server/routes/uploads.js`, `server/db/migrations.js` (a new version for `uploads`), `server/db/index.js` (delete paths call a cleanup hook), a new `server/uploadsGc.js`, `server/server.js` (start the sweep, unref'd, not under test), the README (the new env vars), tests (`server/tests/uploads-quota.test.js`, `uploads-cleanup.test.js`).

## Not in scope
Signed or expiring upload URLs, and a separate user-content origin (P11-00 Discovered Work). Re-encoding images or stripping EXIF (worth a later packet: phone photos carry GPS).
