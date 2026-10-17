# P2-12 — Link previews end-to-end (cache, async unfurl, embed frame, cards)

- **Unit Type:** Implementation (rank 7, slice 2)
- **Phase:** 2, rank 7
- **State:** COMPLETE
- **Effort:** M
- **Depends on:** P2-11, P1-01 (migration), P1-05 (gateway/chat.js, gateway/dm.js)
- **Soft-depends on:** P2-01 (shared URL-detection regex; if P2-01 hasn't landed, put the regex in a shared `server/validate.js` + client util)
- **Requirement Source:** IMPROVEMENT-PLAN.md Phase 2 #7

## Scope
- Migration: `link_previews(url TEXT PRIMARY KEY, data TEXT, fetched_at INTEGER, ok INTEGER)` plus `message_embeds(message_id INTEGER, url TEXT, PRIMARY KEY(message_id, url), FK messages ON DELETE CASCADE)`. DMs use `dm_message_embeds` (or a `kind` column).
- After a message is stored and broadcast:
  - Extract up to 3 http(s) URLs, skipping any inside `<...>` (Discord-style opt-out) or `||spoilers||`.
  - For each URL: serve a cache hit if it's under 24h old; otherwise `unfurl()` with a global concurrency limit of 4 and a per-user rate limit.
  - On success, insert `message_embeds` and send a `message_embeds { id, space, channel, embeds }` frame through `deliverToChannelViewers` (or both DM parties).
- History queries attach `embeds`.
- The instance toggle `LINK_PREVIEWS=on|off` defaults to on. A site admin can turn it off.
- Client:
  - an `Embed.jsx` card (site name, linked title, description, image)
  - the image loads directly from the origin with `referrerpolicy="no-referrer"` and `loading="lazy"`
  - the card is hidden if the message author removes it, which is a non-goal for v1
- Images are **not** proxied in v1 (privacy note: viewers' browsers fetch the og:image). Flag this.

## Acceptance criteria
- [x] Server test: post a message with a URL to the local fixture server (test loopback allowance). Viewers get `message_embeds`, history includes `embeds`, and a non-viewer of a private channel gets nothing.
- [x] A URL to a private IP yields no embed and no outbound request (assert with a spy).
- [x] With the instance toggle off, no fetches happen.
- [x] Manual: a YouTube or GitHub link renders a card within ~2s. A deleted message's embeds are gone (cascade).

## Expected Areas of Change
`server/db/migrations.js`, `server/db/index.js`, new `server/linkPreviews.js` (pipeline), `server/gateway/{chat,dm}.js`, `web/src/components/Embed.jsx` (new), `MessageList.jsx`, the client hooks (handle `message_embeds`), and tests.

## Working Set / Blast Radius
~9 files. Outbound network from the server is new attack surface, contained by P2-11.

## Open questions
- FLAG: proxy the og:images through the server to hide viewer IPs? That costs bandwidth and storage. v1 assumes no proxy.

## Evidence
Baseline: main after #86 (P2-11). Branch `claude/p2-12-link-previews`.

| Acceptance criterion | Evidence |
|---|---|
| Server: a URL to the local fixture yields `message_embeds` for viewers and `embeds` in history; a non-viewer of a private channel gets nothing | `server/tests/linkPreviews.test.js`. Owner and member get the card frame and the outsider doesn't. GET history has `embeds`. In an owners-only channel, the member gets no frame. DMs: both parties get `dm_embeds`, a third user doesn't, and DM history has `embeds`. |
| A private-IP URL: no embed and no outbound request (spy) | `jest.spyOn(http, 'request')` is never called for `http://10.0.0.1/…` and `http://169.254.169.254/…`, and no frame is sent. |
| Toggle off: no fetches | With the setting off, the fixture gets no hit and no frame is sent. The admin route (`PUT /admin/link-previews`) is 403 for non-admins and works for the site admin; `GET /admin/registration` reports `linkPreviews`. |
| Manual: a GitHub link renders a card within ~2s; a deleted message's embeds are gone | Sandbox (:3005): sandy posted `https://github.com/Elldreth/DisGourd`, and the card appeared **617 ms** after Enter, with title, description and GitHub's image (`referrerpolicy=no-referrer`). It survived a reload (history). `http://192.168.1.1/` and `<https://example.com/>` produced no card. Cascade on delete is in the server test (`getEmbedUrls` goes to `[]`). |

Tests: server 174 (9 new in linkPreviews.test.js). Web 398 (Embed ×4, reducer ×1, RegistrationAdmin toggle ×1). Build clean.

### Also in this unit (decided while building)
- **Edits re-run previews:** editing a link away sends an empty list and clears the card; editing one in adds it. Tested.
- **Cache:** a good card is reused for 24h; a failed fetch is retried after 1h. Concurrent requests for the same URL share one fetch. Cache hits don't count against the per-user limit (30 new fetches per 10 minutes).
- **Toggle:** `LINK_PREVIEWS=off` sets the default; the site admin's switch (Settings → Registration & access → Link previews) is stored and wins.
- **Link rules** match the client autolinker (`markdown.jsx`): trailing punctuation and unbalanced `)` are trimmed. Code, `||spoilers||` and `<links>` are skipped. Up to 3 per message.
- **Card safety:** only http(s) links/images and a hex theme colour are used. The image is decorative (`alt=""`), lazy, `no-referrer`, and hidden on error.

### Incident during this unit, and the guard added for it
The first version of `linkPreviews.test.js` required `../linkPreviews` inside a `describe` block, which runs before `beforeAll` sets `DB_PATH=':memory:'`. So `db/index.js` opened its default, the **real `server/db/disgourd.db`**. One test run wrote 3 test users, a "Linkland" server with messages, 1 DM, 6 preview cache rows and a setting, and ran migration 4 on it. The user's own rows were untouched.
- **Guard (in this PR):** `db/index.js` now throws if `NODE_ENV === 'test'` and `DB_PATH` isn't set, so a test can never open the real database again. All 174 server tests pass with it, and the real DB's files were unchanged by a full run.
- **Cleanup (for the user to run):** `.dev/cleanup-test-rows-2026-10-16.js` (not committed). It checks the rows are exactly the test's, backs up first, deletes them in one transaction, drops the v4 tables and sets the schema back to version 3. It was verified on a snapshot copy: it kept `admin` and `test_david`, integrity was ok, and a second run refused.

## Open question (still)
- FLAG: viewers' browsers load each card's image straight from the linked site, so that site sees viewer IPs (not which chat, thanks to `no-referrer`). Proxying images through the server would hide that, at a bandwidth cost. Not done in v1.

## Discovered Work (not done)
- Let the author remove a card from their message (a v1 non-goal).
- Rich players (YouTube/video embeds); v1 shows the thumbnail card only.
