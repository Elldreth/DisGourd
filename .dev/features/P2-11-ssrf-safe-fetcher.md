# P2-11 — SSRF-safe HTTP fetcher + OpenGraph parser (isolated module)

- **Unit Type:** Implementation (slice 1 of rank 7, "Link previews ... with SSRF protection")
- **Phase:** 2, rank 7
- **State:** COMPLETE
- **Effort:** M
- **Depends on:** none (new files only)
- **Serialize with:** none
- **Requirement Source:** IMPROVEMENT-PLAN.md Phase 2 #7

## Why a separate unit
The SSRF guard is the security-critical part. Building it as a pure, heavily tested module with no wiring lets it be reviewed on its own, and lets it run in parallel with the server split.

## Scope
- `server/net/safeFetch.js`: `safeFetch(url, { timeoutMs = 5000, maxBytes = 512 * 1024, maxRedirects = 3 })`.
  - Only `http:` and `https:`. Only ports 80 and 443 (no others, by default). No credentials in the URL.
  - Resolve DNS **once** with `dns.lookup(host, { all: true })` and reject if *any* address is private or reserved: 127/8, 10/8, 172.16/12, 192.168/16, 169.254/16 (metadata), 100.64/10, 0/8, 224/4+, ::1, fc00::/7, fe80::/10, ::ffff:mapped-private, and 64:ff9b::/96 mapping to private.
  - Connect to the **resolved IP** (custom `lookup` on the http(s) agent so the socket can't re-resolve: no DNS rebinding) and keep SNI/Host as the hostname.
  - Re-validate on every redirect hop. Abort over `maxBytes` or the timeout. Only `text/html` (and `application/xhtml+xml`) bodies are read.
  - Send a `User-Agent: DisGourdBot/1.0 (+link preview)` header. Never forward cookies or auth.
- `server/integrations/unfurl.js`: `unfurl(url) → { url, title, description, siteName, image, themeColor } | null`. It parses `og:*`, `twitter:*`, `<title>` and `meta description` from the first 512 KB with a lightweight regex/tokenizer (no DOM dependency). It decodes HTML entities, truncates (title 200, description 300), and resolves a relative `og:image` against the final URL. The image URL is *not* fetched here.

## Acceptance criteria
- [x] New `server/tests/safeFetch.test.js` uses a local http server on 127.0.0.1, with a test-only `allowLoopback` option guarded by `NODE_ENV==='test'`. Cases:
  - [x] Every private range in the list is rejected (table-driven, by stubbing `dns.lookup`).
  - [x] A redirect to `http://169.254.169.254/` is rejected.
  - [x] A DNS answer with one public and one private address is rejected.
  - [x] `file:`, `ftp:` and `gopher:` are rejected.
  - [x] Port 8080 is rejected.
  - [x] A body over the limit is aborted.
  - [x] A slow server times out.
  - [x] A non-HTML content type returns null.
- [x] `server/tests/unfurl.test.js`: fixture HTML yields the expected fields. Entities are decoded. Malformed HTML doesn't throw.
- [x] No new npm dependencies (Node `http`/`https`/`dns`/`net` only).

## Expected Areas of Change
New `server/net/safeFetch.js`, `server/integrations/unfurl.js`, and the two test files.

## Working Set / Blast Radius
New files only. Zero runtime impact until P2-12 wires them in.

## Evidence
Baseline: main at ec68514 (after #85). Branch `claude/p2-11-safe-fetch`.

| Acceptance criterion | Evidence |
|---|---|
| Every private range rejected (table-driven) | `safeFetch.test.js` "address checks": 32 blocked addresses. These include 127/8, 10/8, 172.16/12, 192.168/16, 169.254/16, 100.64/10, 0/8, 224/4, 240/4, ::, ::1, fc00::/7, fe80::/10, ff00::/8, `::ffff:` mapped (dotted and hex), 64:ff9b:: NAT64 to private, 6to4 to private, and documentation ranges. 8 public look-alikes are allowed (172.32.0.1, 100.128.0.1, ::ffff:8.8.8.8, 64:ff9b::808:808…). Six resolver answers are refused before any request. |
| Redirect to 169.254.169.254 rejected | The local server 302s to the metadata URL, and the hop is refused (BLOCKED_ADDRESS). |
| One public + one private DNS answer rejected | Stub resolver returns 93.184.216.34 + 10.0.0.5, and the fetch is refused. |
| file:, ftp:, gopher: rejected | Plus data: and javascript: (BLOCKED_PROTOCOL). |
| Port 8080 rejected | BLOCKED_PORT, checked before DNS. |
| Body over the limit aborted | A streamed 1 MB body with a 64 KB cap is cut off (TOO_LARGE). A declared Content-Length over the cap is refused without reading. |
| Slow server times out | 300 ms deadline on a server that never finishes (TIMEOUT in under 2s). **Also a DNS lookup that never answers times out**: added after review found the deadline didn't cover DNS. |
| Non-HTML returns null | image/png gives null. A 404 also gives null. |
| `unfurl.test.js`: fixture fields, entities, malformed HTML | og:* wins; twitter:* then `<title>`/description fallbacks; `&amp; &#39; &quot; &#x2014; &nbsp; &lt;` decoded; 200/300 cut with an ellipsis; relative og:image resolved; javascript:/data:/file: images dropped; six malformed inputs don't throw; end to end through safeFetch on a local server. |
| No new npm dependencies | Only `http`, `https`, `dns`, `net`. package.json is untouched. |

Server tests: 165 pass (75 new across the two files; 90 existing). This is server-only and not wired into the app, so a browser sandbox check doesn't apply.

Live check (one read-only request): `unfurl('https://example.com/')` gave `{ title: 'Example Domain', … }`. That proves HTTPS works with the pinned address and SNI. `http://localhost:3000/` (BLOCKED_PORT), `http://169.254.169.254/…` and `http://127.0.0.1/` (BLOCKED_ADDRESS) were refused without a connection.

### Design notes
- **No DNS rebinding:** each hop resolves once, checks every address, then connects with a pinned `lookup` that returns only the checked address (handling Node's `all: true` form). `agent: false` means no pooled sockets. SNI and Host stay the hostname.
- **Errors** carry `code` (BAD_URL, BLOCKED_PROTOCOL, BLOCKED_PORT, CREDENTIALS, BLOCKED_ADDRESS, TOO_MANY_REDIRECTS, TOO_LARGE, TIMEOUT, NETWORK). Non-2xx and non-HTML give `null`. `unfurl` turns any failure into `null`.
- **Test hook:** `allowLoopback` only works when `NODE_ENV === 'test'`, and only for loopback (and that loopback's port). A test proves it's ignored under `production`. `lookup` is injectable, which keeps the table tests free of global stubs.
- Sends `Accept-Encoding: identity` so the byte cap counts real bytes. Respects `charset=`. Cookies and auth are never sent.

## For P2-12 (wiring)
Call `unfurl(url)` off the message path (after send, cached per URL). Don't fetch the returned `image` from the server without the same checks; let the browser load it, or proxy it through `safeFetch`-style rules.
