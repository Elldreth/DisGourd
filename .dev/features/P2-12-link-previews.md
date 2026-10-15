# P2-12 — Link previews end-to-end (cache, async unfurl, embed frame, cards)

- **Unit Type:** Implementation (rank 7, slice 2)
- **Phase:** 2, rank 7
- **State:** PLANNED
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
- [ ] Server test: post a message with a URL to the local fixture server (test loopback allowance). Viewers get `message_embeds`, history includes `embeds`, and a non-viewer of a private channel gets nothing.
- [ ] A URL to a private IP yields no embed and no outbound request (assert with a spy).
- [ ] With the instance toggle off, no fetches happen.
- [ ] Manual: a YouTube or GitHub link renders a card within ~2s. A deleted message's embeds are gone (cascade).

## Expected Areas of Change
`server/db/migrations.js`, `server/db/index.js`, new `server/linkPreviews.js` (pipeline), `server/gateway/{chat,dm}.js`, `web/src/components/Embed.jsx` (new), `MessageList.jsx`, the client hooks (handle `message_embeds`), and tests.

## Working Set / Blast Radius
~9 files. Outbound network from the server is new attack surface, contained by P2-11.

## Open questions
- FLAG: proxy the og:images through the server to hide viewer IPs? That costs bandwidth and storage. v1 assumes no proxy.
