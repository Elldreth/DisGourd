# P2-11 — SSRF-safe HTTP fetcher + OpenGraph parser (isolated module)

- **Unit Type:** Implementation (slice 1 of rank 7, "Link previews ... with SSRF protection")
- **Phase:** 2, rank 7
- **State:** READY
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
- [ ] New `server/tests/safeFetch.test.js` uses a local http server on 127.0.0.1, with a test-only `allowLoopback` option guarded by `NODE_ENV==='test'`. Cases:
  - [ ] Every private range in the list is rejected (table-driven, by stubbing `dns.lookup`).
  - [ ] A redirect to `http://169.254.169.254/` is rejected.
  - [ ] A DNS answer with one public and one private address is rejected.
  - [ ] `file:`, `ftp:` and `gopher:` are rejected.
  - [ ] Port 8080 is rejected.
  - [ ] A body over the limit is aborted.
  - [ ] A slow server times out.
  - [ ] A non-HTML content type returns null.
- [ ] `server/tests/unfurl.test.js`: fixture HTML yields the expected fields. Entities are decoded. Malformed HTML doesn't throw.
- [ ] No new npm dependencies (Node `http`/`https`/`dns`/`net` only).

## Expected Areas of Change
New `server/net/safeFetch.js`, `server/integrations/unfurl.js`, and the two test files.

## Working Set / Blast Radius
New files only. Zero runtime impact until P2-12 wires them in.
