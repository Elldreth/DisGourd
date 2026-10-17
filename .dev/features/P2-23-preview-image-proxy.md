# P2-23 — Link-preview image proxy

- **Unit Type:** Implementation
- **Phase:** 2 (follow-up to P2-12's open privacy question)
- **State:** COMPLETE
- **Effort:** S–M
- **Depends on:** P2-11 (safeFetch), P2-12 (cards)
- **Serialize with:** linkPreviews.js, routes/spaces.js, routes/social.js, Embed.jsx units
- **Requirement Source:** P2-12 "Open question": proxy og:images to hide viewer IPs. The user chose to build it (2026-10-17).
- **Starting baseline:** `main` after #89

## Problem
A card's image loads straight from the linked site in every viewer's browser, so that site sees each viewer's IP address (no referrer, so not which chat it was in).

## Design
- **Signed proxy URLs, not an open proxy.** The server rewrites each card's `image` to `/media/preview/<sig>/<b64url(url)>`. `sig` is an HMAC-SHA256 of the URL under a key derived from the server's secret. The route refuses anything it didn't sign, so nobody can use the server to fetch arbitrary images. No table is needed.
- **Rewrite on the way out** (frames and history responses), never in the stored card. Cards cached before this change get proxied too, and turning the proxy off is instant.
- **Fetch safely:** `safeFetch` gains `types` (allowed content types) and `as: 'buffer'`. Images use the same address, port and redirect checks as pages, a 5 MB cap and a 10 s timeout. Allowed: png, jpeg, gif, webp, avif. **No SVG** (it can carry script).
- **Verify the bytes:** the first bytes must be a real png/jpeg/gif/webp/avif. The response type comes from those bytes, not the remote header. It's served with `nosniff`, `Content-Security-Policy: default-src 'none'` and `Cache-Control: public, max-age=86400`.
- **Disk cache** in `UPLOADS_DIR/.previews/<sig>` (+ `.type`): fetched on first view, shared by everyone, in-flight dedupe, at most 4 fetches at once. A failure is remembered for 10 minutes. The cache is capped at 200 MB by pruning the oldest files.
- **Switch:** `LINK_PREVIEW_IMAGES=direct` keeps the old direct loading (to save bandwidth). The default is `proxy`.
- **Client:** the card accepts same-origin `/media/preview/` image paths. The dev server forwards `/media`.

## Acceptance criteria
- [x] Cards in `message_embeds` / `dm_embeds` frames and in channel and DM history carry a `/media/preview/…` image, never the remote URL (unless `LINK_PREVIEW_IMAGES=direct`).
- [x] The route serves the image from a local fixture (test loopback), with the right type and safety headers. The second request comes from the cache (no second upstream hit).
- [x] A tampered signature or URL gives 404 with no upstream request.
- [x] SVG, HTML disguised as image/png, an oversize body, and a private address are all refused (404), with no request for the private address.
- [x] Sandbox: a GitHub link's card image loads from the DisGourd origin, and the browser makes no request to the image's own site.

## Expected Areas of Change
New `server/net/imageProxy.js`, `server/net/safeFetch.js` (types/buffer options), new route in `routes/uploads.js` (or its own module), `linkPreviews.js` (deliver), `routes/spaces.js` + `routes/social.js` (history), `web/src/components/Embed.jsx`, `web/vite.config.js`, tests.

## Working Set / Blast Radius
~9 files. It adds one public GET route, gated by HMAC.

## Evidence
| Acceptance criterion | Evidence |
|---|---|
| Frames and history carry `/media/preview/…`, not the remote URL (unless `direct`) | `imageProxy.test.js`: the live `message_embeds` card image equals `proxyPath(fixture image)`, and history returns the same; `LINK_PREVIEW_IMAGES=direct` gives the original. `linkPreviews.test.js` (P2-12) is updated to expect the proxy path. DM frames and history use the same `publicCard` / `withPublicEmbeds`. |
| Served from the fixture with the right type and headers; the second request comes from the cache | The test gets `image/png`, nosniff, `default-src 'none'` and `max-age=86400`, with identical bytes. Two GETs cause one upstream hit. |
| A tampered signature or URL gives 404 with no upstream request | Another URL's signature, a garbage signature, an encoded `..%2F` path and an extra segment are all 404, and the fixture saw no request. |
| SVG, HTML-as-PNG, oversize and a private address are refused | All four are 404. For `http://10.0.0.1/…`, an `http.request` spy was never called. |
| Sandbox: a GitHub card image loads from DisGourd, and the browser never contacts the image host | Tx Check #general had the P2-12 GitHub card, stored with the original URL, so this also proves older cards are rewritten on the way out. The `<img>` src is `/media/preview/…`, loaded at 1200 px wide. The browser network log had **no request matching `githubassets`** and one `GET /media/preview/… → 200`. Response headers: image/png, nosniff, `default-src 'none'`, CORP same-origin, `max-age=86400`. The cache file is in `uploads/.previews/`. A forged signature for the metadata address gave 404. |

Server 191 pass (10 new in imageProxy.test.js; P2-12's card test updated). Web 404 pass (2 new Embed tests). Build clean. safeFetch's own 75 tests are unchanged and passing after the `types`/`as` options were added.

### Notes
- The cache lives inside `UPLOADS_DIR`, so `/uploads/.previews/<sig>` also returns the bytes, as an attachment with no image type. That needs the same unguessable signature, so it shows nothing new; the proxy route is the real way in.
- Rotating the server secret changes every signature. Old proxy paths then 404 and new ones are issued on the next history load or frame; the cache simply refills.
- Bandwidth: each image is fetched once per server, cached for every viewer, and capped at 200 MB. `LINK_PREVIEW_IMAGES=direct` turns the proxy off.
