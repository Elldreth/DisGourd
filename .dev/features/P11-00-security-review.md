# P11-00 — Security review for the public cloud (Container)

- **Unit Type:** Container (security review + child packets)
- **Phase:** 11 (security)
- **State:** COMPLETE as a review (merged in #210; the owner agreed with the assessment). Its children are the plan; the build order is in "Plan: the order to build in", updated for the deployment as built.
- **Effort:** L in total (children S–M each)
- **Depends on:** main at 92f7178 (after #208)
- **Requirement Source:** the owner, relayed 2026-10-20: DisGourd is moving from the Unraid box (behind SWAG, closed registration) to a cloud host, "so it must be safe on the open internet". Review first, then a prioritized plan; this unit changes no app code.

## The short version
> **Update 2026-10-21:** DisGourd now runs on the Unraid box behind a Cloudflare Tunnel, with no open ports. See "Deployment as built" for what that already covers, and "Plan: the order to build in" for the order, starting with P11-10.

- **Nothing Critical can be used against today's instance.** It already has accounts, and registration is closed.
- **One thing becomes Critical on move day:** a new, empty instance gives site admin to whoever registers first, even with `REGISTRATION_MODE=closed` (C1). If the cloud box starts empty, fix that first (P11-01), or copy the existing `/config` over before the port opens.
- **Three High issues** should be fixed before the instance goes public:
  - A role holding `manage_roles` can promote itself to Admin (H1).
  - Any signed-in member can fill the disk (H2).
  - The sample deployment publishes port 3000 and trusts `X-Forwarded-For`, so anyone can bypass the login rate limits (H3).
- The code is in good shape. Link previews and the image proxy have solid SSRF rules. SQL is parameterised everywhere. The markdown renderer never uses innerHTML. Uploads can't traverse paths, and HTML/SVG uploads are served as downloads. The JWT secret strength is enforced, and sessions can be revoked. The production dependencies have 0 known vulnerabilities.

## Threat model
- **Who:** strangers on the internet (no account), anyone with an account (registration code, invite, or open sign-up), a member with some moderator permissions, and a site admin whose password leaks.
- **What matters:** taking over accounts or the instance, reading private channels or DMs, the owner's kie.ai credits and key, the cloud VM itself (metadata credentials, disk, bill), and participants' IP addresses.
- **What changes in the cloud:**
  - There's no LAN firewall any more.
  - Docker-published ports skip host firewalls like ufw.
  - Proxy and load-balancer logs may be kept by a third party.
  - Disk and bandwidth cost money.
  - The ComfyUI box stays at home and has to be reached over a tunnel.

## Findings
Severity measures how bad it is on a public cloud instance with registration by code or invite. Each finding gives file:line, how it's exploited, and the fix (with the child packet that does it).

### Critical
**C1. First account on an empty instance becomes site admin, whatever the registration mode** — P11-01
- Where:
  - `server/routes/auth.js:62` — `firstAccount` skips the mode and code checks.
  - `server/db/index.js:1926-1930` — `createUser` makes the first account site admin.
  - `server/routes/auth.js:48` — `/auth-info` says `setup: true` to anyone.
- Exploit: the owner starts a fresh cloud instance (new volume, or a test deploy) and opens the port. Scanners that hit `/auth-info` see `{"registration":"closed","setup":true}`. `POST /register` gets them in, and they're site admin. From there they can switch registration to open, read the instance settings, use the saved kie.ai key through /imagine and the "try" endpoint, and promote friends.
  - Confirmed with the proof script, REGISTRATION_MODE=closed: `auth-info: { registration: 'closed', setup: true }` → `C1 first register while closed -> 201 siteAdmin = true`.
- Fix: on an empty instance, require a one-time setup code. Generate it at boot when there are no users, print it to the log, and keep it in `/config/.setup-code` (0600). The first `/register` must carry it, and the wizard asks for it. Also:
  - `SITE_ADMINS` (`server/config.js:47`) promotes by name on every boot. Only promote accounts that already exist, warn when a listed name isn't registered, and don't re-promote someone a site admin demoted. Otherwise a stranger can register a listed-but-unused name (a typo, or a fresh instance with open sign-up) and become admin on the next restart.
- Today: not exploitable. The Unraid instance has accounts.

### High
**H1. The legacy tier route skips the role hierarchy, so `manage_roles` can mint Admins** — P11-02
- Where: `server/routes/spaces.js:179-188`. `PATCH /spaces/:s/members/:u { role: 'admin' }` checks only `manage_roles`. Through `applyTierMember` (`server/db/index.js:336-342`) it gives or removes the seeded Admin role. There's no position check, no "role below yours" check, and no rule against targeting yourself.
- Exploit: an owner makes a "Mods" role with `manage_roles` (a normal thing to do; the roles screen promises Mods can only manage roles below their own). A Mod sends that PATCH to themself and becomes Admin: edit server, ban, kick, delete channels. Or they PATCH a real Admin to `member` and take away their Admin role.
  - Confirmed: the roles API refuses (`403 You can only give or take roles below your own`), but the legacy PATCH answers 200, and the Mod gains `edit_server` and `ban_members`.
- Fix: apply the same rules as `routes/roles.js:132-149` (role below yours, target below you or yourself, never above), or remove the route. The app gives roles through `/members/:u/roles/:id`; check the web client for callers first.
- Today: exploitable only if a non-owner role has been given `manage_roles` (by default only the owner has it).

**H2. Any signed-in member can fill the disk or flood the gateway** — P11-03, P11-04
- Where:
  - `server/gateway/chat.js:72-76`. The `read` op stores `(space, channel)` strings with no membership or existence check (`server/db/index.js:1275`), and a frame can be 256 KB (`server/http/util.js:51`). Confirmed: 20 frames left 20 rows and 4.7 MB. A script makes gigabytes a minute.
  - No per-user rate limit on `message`, `dm`, `react`, `typing` or any other op (`server/gateway/router.js:18-51`, `chat.js:78`, `dm.js:109`). Slow mode is opt-in per channel. Each message also fans out to every viewer, @mention pushes, and link-preview work.
  - No cap on sockets per user (`server/gateway/index.js:99-100`).
  - Uploads: 25 MB each, as many as you like, no per-user quota (`server/routes/uploads.js:79-147`). Files are never deleted, even when their message is.
  - `GET /search` runs `LIKE '%q%'` over every visible message with no rate limit (`server/routes/social.js:83-90`). Cheap to call, expensive on a big database.
- Exploit: one invite or registration-code holder runs a loop. The volume fills, SQLite starts failing writes, and the chat goes down for everyone. On a pay-per-GB volume, the bill grows too.
- Fix:
  - P11-03 (gateway): validate `read` against the user's real channels; a token bucket per user and per op (for example 10 messages per 10 s, 30 frames per second overall, typing at most once a second); at most 10 sockets per user; close abusive sockets with code 1008.
  - P11-04 (uploads): a per-user daily byte quota and a total-storage cap (`MAX_UPLOAD_BYTES_PER_DAY`, `UPLOADS_MAX_TOTAL_BYTES`); delete files with their message; a sweep for orphaned upload folders.
  - The search rate limit goes in P11-03.

**H3. The sample deployment publishes port 3000 and trusts X-Forwarded-For, so the rate limits are spoofable** — P11-05
- Where:
  - `docker-compose.yml:46` publishes `3000:3000` on every interface, and `docker-compose.yml:30` sets `TRUST_PROXY=1`.
  - `server/auth/rateLimit.js:29-38` then trusts the last `X-Forwarded-For` hop from any peer.
  - `server/static.js:38` trusts `X-Forwarded-Host` / `-Proto` even without TRUST_PROXY.
- Exploit: copy the compose file to a cloud VM and port 3000 is open to the internet. Docker's iptables rules skip ufw and firewalld. An attacker talks straight to `:3000` over plain HTTP and sends a new `X-Forwarded-For: 1.2.3.<n>` with each request. Every attempt lands in a fresh bucket, so the 15-per-15-minutes login limit and the 5-per-15-minutes registration limit stop working. That leaves unlimited password guessing against the site admin. Plain HTTP on :3000 also carries tokens unencrypted.
- Fix: `TRUSTED_PROXIES` (CIDRs, default loopback and the Docker bridge). Use X-Forwarded-For only when the socket peer is in that list, and then take the right-most hop that isn't itself a trusted proxy. Ship a cloud compose and proxy sample:
  - Nothing published except 80 and 443 on the proxy, or `127.0.0.1:3000:3000`.
  - Container hardening (`read_only`, `cap_drop: [ALL]`, `no-new-privileges`, a pinned image).
  - A proxy config that sets HSTS and keeps `token=` out of access logs (see M2).

### Medium
**M1. No security headers: CSP, frame-ancestors, HSTS, nosniff on the app; CORS `*`** — P11-06
- Where: `server/http/handler.js:12-15` sets only CORS `*`. `server/static.js:79` serves the app shell with no CSP, X-Frame-Options, Referrer-Policy or Permissions-Policy. The SWAG sample (`deploy/swag/disgourd.subdomain.conf.sample`) adds none either.
- Exploit: the session token sits in `localStorage` (`web/src/api.js:5-15`) for 7 days (`server/auth/tokens.js:5`). No XSS was found, but if one ever turns up (a dependency, a future renderer change), there's no CSP to stop it, and one script reads the token. Separately, any site can frame DisGourd and overlay buttons (clickjacking: Leave server, Transfer…, Delete message). CORS `*` lets any origin read API answers if it has a token. That doesn't help an attacker today, but it removes a layer.
- Fix:
  - A strict CSP on the shell: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:` (plus `https:` only when `LINK_PREVIEW_IMAGES=direct`); `media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'`. The client loads no third-party scripts, and `theme-init.js` is a file, not inline.
  - `X-Content-Type-Options: nosniff` everywhere, `Referrer-Policy: same-origin`, a `Permissions-Policy` that allows only camera, microphone and display-capture on self, and HSTS at the proxy.
  - CORS: same-origin by default, with an `ALLOWED_ORIGINS` env for the Vite dev proxy.

**M2. Session tokens travel in URLs and end up in logs** — P11-07
- Where: `web/src/useSocket.js:37` opens `/gateway?token=…`. `server/gateway/index.js:83` reads it. `server/auth/tokens.js:60` also accepts `?token=` on every HTTP route.
- Exploit: SWAG/nginx, a cloud load balancer, a CDN, or a log shipper records the request line, `GET /gateway?token=eyJ…`. That's a working 7-day credential for anyone who can read the logs: the hosting provider, a log service, or a later breach of the box.
- Fix: authenticate the socket in its first frame (`{ op: 'auth', token }` within 5 s, or close) or through `Sec-WebSocket-Protocol`. Stop accepting `?token=` on HTTP; the app already sends `Authorization: Bearer`. Until then, the P11-05 proxy sample strips the query from access logs.

**M3. Sign-in can be brute-forced from many addresses; the limiter itself can grow** — P11-08
- Where:
  - `server/routes/auth.js:120` limits per IP only (15 per 15 minutes); there's no per-account limit. IPv6 clients rotate through a /64 for free.
  - `server/validate.js:45` asks only for 8 or more characters.
  - `server/auth/rateLimit.js:15-17` cleans up only expired buckets, so a flood of new keys grows the map without bound.
  - Site admins have no second factor.
- Exploit: usernames are public (member lists, mentions). A botnet or an IPv6 /64 sprays common passwords at the owner's account, 15 tries per address. (Before P11-05 it doesn't even need many addresses; see H3.)
- Fix:
  - A per-account limit (for example 10 failures per 15 minutes, then a growing delay), counted whichever IP the attempt comes from.
  - Key IPv6 by /64.
  - Cap the limiter map (LRU).
  - Refuse the most common passwords at sign-up and on password change (a small built-in list).
  - TOTP for site admins is recorded as a follow-up (bigger).

**M4. Uploads stay public and outlive their messages** — P11-04
- Where: `server/routes/uploads.js:151-196` serves `/uploads/<token>/<name>` to anyone, with no login, and `Cache-Control: public, max-age=31536000, immutable`. Deleting a message or DM (`server/db/index.js:1787-1793`, `1588`) leaves the file.
- Exploit: a photo shared in a private channel or a DM, then deleted, is still served to anyone who has the link (someone it was forwarded to, a browser history, a scraped log), and caches keep it for a year. The 72-bit token stops guessing, not sharing.
- Fix: delete an upload's folder when the last message that references it is deleted (P11-04). Add `Content-Security-Policy: default-src 'none'; sandbox` and `Cross-Origin-Resource-Policy: same-origin` to `/uploads`. Cache privately for a short time (`private, max-age=86400`). Optional and recorded only: signed, expiring upload URLs, which would need the app to request them.

**M5. Admin-set ComfyUI URL can reach the cloud metadata service; ComfyUI itself must not be exposed** — P11-10
- Where: `server/imagine/engines/comfyui.js:428-437` fetches any http(s) URL the admin saved (`:825-830`), with redirects followed by `fetch`. `/admin/imagine/comfyui/test` (`server/routes/admin.js:80-87`) echoes the parsed answer.
- Exploit: a stolen site-admin login points ComfyUI at `http://169.254.169.254/…` (or the provider's metadata hostname) and reads instance credentials back through the error and list replies. Separately, the obvious way to reach the home ComfyUI from the cloud, port-forwarding it to the internet, exposes an unauthenticated service that runs arbitrary workflows (custom nodes run code).
- Fix: refuse link-local addresses (169.254.0.0/16, fe80::/10) and the metadata hostnames for the ComfyUI URL, before the request and on each redirect (`redirect: 'manual'`). LAN and tailnet ranges stay allowed, because ComfyUI legitimately lives there. Document reaching ComfyUI over Tailscale or WireGuard, never a public port. Use IMDSv2 on hosts that have it.

**M6. Usernames are case-sensitive, so "Elldreth" and "elldreth" can both exist** — P11-12
- Where: `server/db/migrations.js:43` (`username TEXT UNIQUE`, no NOCASE) and `server/db/index.js` (`getUserByUsername` is an exact match).
- Exploit: someone registers `Elldreth` next to the owner's `elldreth`, DMs members as "the admin", and is @mentioned by mistake. `SITE_ADMINS` matching (C1) is exact too.
- Fix: a migration adding a case-insensitive unique index. It lists any existing collisions first and stops with a clear message. Lookups become case-insensitive.

**M7. Anyone on the instance can DM anyone** — P11-09
- Where: `server/gateway/dm.js:109-123`. A first DM makes a pair conversation with any username. Friend requests (`server/routes/social.js:134-147`) aren't limited either.
- Exploit: on a public instance, a stranger with an account DMs or friend-requests every user. Blocking works only after the fact.
- Fix: a per-user "Who can DM me" setting: friends and people I share a server with (default), or everyone. Rate limit new conversations and friend requests per user.

**M8. Voice calls show every participant's IP address to everyone in the call; the forced mute is only advisory** — P11-11
- Where: `web/src/voice.js:20-23` (STUN only, mesh, and `window.__DISGOURD_ICE__` is never set by the server). `server/gateway/voice.js:88,124`: a timed-out member is "muted" in the room state, but their audio goes peer to peer.
- Exploit: anyone who can join a voice channel collects the public IP of everyone in it from the ICE candidates (`chrome://webrtc-internals`, or a modified client). A timed-out member's modified client keeps sending audio.
- Fix: serve ICE servers from the server (`ICE_SERVERS` / `TURN_URL` + `TURN_SECRET` with time-limited coturn credentials). Add an instance option `VOICE_RELAY_ONLY` (`iceTransportPolicy: 'relay'`) so peers only ever see the TURN server. Honest clients drop the audio track from a peer the server marks force-muted; full enforcement needs an SFU and is recorded, not planned.

**M9. Site admins can't suspend an account** — P11-09
- Where: there's no instance-level user moderation. `server/routes/admin.js` only manages registration, codes and admins. Bans are per server.
- Exploit: an abusive account (a leaked registration code) can be banned from each server, but it keeps signing in, DMing people (M7), uploading (H2) and joining servers through invites.
- Fix: `PUT /admin/users/:username { suspended }`. It sets a flag, bumps `token_version` (closing sockets), and makes login and `verifyToken` refuse. Plus a minimal list in the site-admin settings.

**M10. Push subscriptions can point anywhere: a blind POST from the server** — P11-10. **High when the server sits on the home LAN or a tailnet** (see "Hosting setups").
- Where: `server/routes/push.js:8-10` accepts any `https://` endpoint, and `server/push.js:69` POSTs to it when the user is mentioned. It's the one server-side request that doesn't go through `safeFetch`.
- Exploit: a member registers `https://192.168.1.1/…` (the router), `https://<unraid>/…`, `https://100.x.y.z/…` (a tailnet host) or any internal https service as their "push endpoint", then gets themself @mentioned. The server sends POSTs there. It's blind (the body is ciphertext), but it reaches the LAN, and it can be used to make the server hammer a third party.
- Fix: accept only the known push services' hosts (FCM, Mozilla autopush, Windows WNS, Apple web push), or vet the endpoint with `isBlockedAddress` from `server/net/safeFetch.js`. Cap subscriptions per user (for example 10).

### Low
These go to one sweep packet, P11-13, unless noted.
- **L1.** Error texts are echoed. `server/routes/auth.js:112,144` return `e.message` from any throw in register and login. Return a fixed message and log the rest.
- **L2.** Backups and secrets at rest:
  - `VACUUM INTO` (`server/backup.js:48`) writes unencrypted copies with the default umask, on the same volume as the database.
  - The copies include password hashes, every DM, and the kie.ai key if it was saved in the app (`server/imagine/engines/kie.js:238`).
  - Fix: chmod 0600, document an off-site encrypted copy (restic or rclone to object storage), and prefer `KIEAI_API_KEY` in the environment on the cloud host (already supported, `kie.js:64`).
- **L3.** Moderators can see excerpts from channels they can't view.
  - Report lists (`server/routes/spaces.js:247`) and the moderation log (`:151-161`) include excerpts from channels the moderator can't view. Filter them by `canViewChannel`.
  - `DELETE /spaces/:s/channels/:c` (`:654-658`) works on a private channel the actor can't see. Require view.
- **L4.** Tokens without a session id are still accepted. Tokens from before P9-03 have no `sid` and run until they expire (`server/auth/tokens.js:44-49`); stop accepting them. Sockets are never re-checked after a token expires; re-verify on the heartbeat.
- **L5.** No Origin check on the `/gateway` upgrade (`server/gateway/index.js:77-88`). The token is the real gate, but checking against `ALLOWED_ORIGINS` is cheap defence in depth.
- **L6.** Registration leaks which usernames and emails exist: `/register` answers 409 "User already exists" for either (`server/routes/auth.js:89-91`). Usernames are public anyway; emails shouldn't be. Use one message.
- **L7.** Invites never expire by default (`server/routes/spaces.js:361`). Default to 7 days and offer "never".
- **L8.** Container (P11-05):
  - No `read_only` filesystem, `cap_drop` or `no-new-privileges` in the compose file.
  - The base image is a moving tag (`node:22-bookworm-slim`).
  - `.dockerignore` doesn't list `**/.vapid.json` (it's gitignored, but a local one would be baked into the image).
- **L9.** Dependencies:
  - `npm audit --omit=dev` finds 0 in both server/ and web/.
  - The full audit finds dev-only issues: server/ has 3 high and 3 moderate in the Jest toolchain (brace-expansion, js-yaml, browserslist, sprintf-js). web/ has 1 high, Vite 8.3.0–8.3.2's `launch-editor` (the dev server on Windows).
  - Fix: `npm audit fix` and a Vite bump. Neither ships in the image.
- **L10.** The HTTP server keeps Node's default timeouts, and the WS upgrade has no IP-level connection cap. The proxy should cap connections per IP (in the P11-05 sample).

### Checked and fine (no action)
- **SSRF in link previews and the image proxy** (`server/net/safeFetch.js`):
  - http(s) on ports 80/443 only.
  - Every resolved address is checked: private, loopback, link-local, NAT64, 6to4 and Teredo are refused.
  - The connection is pinned to the checked address, so DNS rebinding can't swap one in.
  - Each redirect is re-checked, with a deadline and a byte cap.
  - `allowLoopback` works only under `NODE_ENV=test`, which also covers the kie.ai result download (`kie.js:198`).
  - The image proxy fetches only URLs it signed (HMAC), sniffs the real image type (no SVG), and serves with `default-src 'none'` and nosniff.
- **SQL:** every statement is a prepared statement with `?`. Interpolated pieces are fixed table names or `?` lists (`inList`).
- **XSS in the client:**
  - `web/src/markdown.jsx` builds React elements and autolinks only http(s), with `rel="noopener noreferrer nofollow"`.
  - Embeds accept only http(s) or our proxy paths and hex colours (`web/src/components/Embed.jsx:7-9`).
  - The only `dangerouslySetInnerHTML` is the built-in server glyph tiles (constants).
  - Avatars, icons and attachments must be `/uploads/` paths.
- **Uploads:**
  - Path traversal is guarded on both write and read.
  - Executables are refused.
  - SVG, HTML, JSON and the like are served as `attachment` with nosniff, and only plain media is shown inline.
  - The server emoji and /imagine readers re-check the path shape.
- **Auth:**
  - HS256 with a fixed algorithm and a timing-safe compare.
  - Weak and placeholder secrets are refused, and generated ones are stored 0600.
  - Passwords use async scrypt (N=16384), with a dummy hash for unknown users.
  - A password change and "sign out other devices" bump the token version and close sockets.
  - The kie.ai key is never sent back (`keyHint` shows the last 4 characters).
  - The ComfyUI URL never reaches members (`decorateSpaces` sends only style names).
- **Authorization:**
  - Every route under `/spaces/:s` checks membership first.
  - Channel reads, pins, threads and versions check `canViewChannel`.
  - Kick, ban, timeout and roles use rank checks (apart from H1).
  - DMs check that you're in the conversation; edit and delete are author-only in SQL.
  - Group DM add and remove follow the owner and shared-server rules, and blocks apply to DMs, groups, typing and pushes.
- **Limits:** JSON bodies are capped at 64 KB, WebSocket frames at 256 KB, messages at 4,000 characters, and /imagine has daily per-user limits plus a monthly kie.ai credit cap.
- **Container:** a non-root user, root-owned app files, a healthcheck, and a clear message when the volumes have the wrong owner.

## Hosting setups (added 2026-10-20, from the hosting research)
The hosting session is weighing two setups. **A, a VPS:** the existing image, Cloudflare and/or Caddy for TLS, Tailscale back to the home PC for ComfyUI (:8188), Litestream backing the database up to Cloudflare R2, maybe a TURN relay, and email over SMTP. **B, the Unraid box at home:** Docker, SWAG, Cloudflare (or DuckDNS), and ComfyUI on the LAN. Both put the server one hop from the owner's home network (B directly, A over the tailnet), so a server-side request that can be steered is the top concern.

**Server-side requests, checked one by one:**
| Request | Guard | Home LAN, tailnet and metadata |
|---|---|---|
| Link previews (`integrations/unfurl.js`) | `safeFetch` | Blocked. After DNS resolution it refuses loopback, 10/8, 172.16/12, 192.168/16, 169.254/16, 100.64/10 (CGNAT, which covers Tailscale's 100.x), fc00::/7 (which covers Tailscale's fd7a:115c:a1e0::/48), fe80::/10, and IPv4-mapped forms. The connection is pinned to the checked address, and every redirect is checked again. Spot-checked: `100.101.102.103`, `fd7a:115c:a1e0::1`, `192.168.1.20`, `::ffff:100.100.1.1` → blocked; `8.8.8.8` → allowed. |
| Preview images (`net/imageProxy.js`) | `safeFetch` | Blocked (same rules). |
| kie.ai result downloads (`engines/kie.js:198`) | `safeFetch` | Blocked. Its `allowLoopback` works only under `NODE_ENV=test`. |
| kie.ai API calls | none needed | The host is fixed in code (`api.kie.ai`), not taken from users. |
| **Push endpoints** (`push.js:69`) | **none** | **Not blocked: M10. In a home or tailnet setup this is the gap to close first (P11-10).** |
| ComfyUI (`engines/comfyui.js:432`) | none, on purpose | The one deliberate exception: a site admin points it at the home ComfyUI. P11-10 adds a metadata/link-local block. The real control is the network: in A, a Tailscale ACL that lets the VPS reach only `home-pc:8188`; in B, a firewall rule (below). |
| Webhooks or other integrations | none exist | `server/integrations/` holds only the unfurler. Any future webhook must use `safeFetch`. |
| TURN relay (if added) | coturn's own rules | A TURN server relays to any address a client names, unless told not to. P11-11's coturn config must deny private, CGNAT/tailnet and ULA peers (`denied-peer-ip` for 10/8, 172.16/12, 192.168/16, 100.64/10, 169.254/16, 127/8, fc00::/7, fe80::/10). |

**Container egress (B especially):** if the app were ever compromised (RCE), the container can reach the whole LAN. On Unraid, a `DOCKER-USER` iptables rule (or a VLAN or custom network) can drop traffic from the DisGourd network to the LAN, except the ComfyUI host:8188 and the router's DNS. In A, Tailscale ACLs do the same: the VPS gets a tag that may reach only `home-pc:8188`, doesn't accept subnet routes, and isn't an exit node. Documented in P11-05 and P11-10.

**Client IP behind Cloudflare** (H3, P11-05):
- **Without real-IP setup at the proxy:** when Cloudflare proxies, the TCP peer SWAG or Caddy sees is a Cloudflare edge address. SWAG's `proxy.conf` appends `$remote_addr` to X-Forwarded-For, and the app takes the last hop. So every visitor coming through one edge shares a rate-limit bucket: one attacker's bad passwords lock everyone out (and vice versa). It's not a bypass, but it's a lockout DoS.
- **The fix at the proxy:** For SWAG, use nginx's real-IP module with Cloudflare's published ranges: `set_real_ip_from <each Cloudflare range>` plus `real_ip_header CF-Connecting-IP` (linuxserver's `swag-cloudflare-real-ip` mod keeps the list current); Caddy has `trusted_proxies cloudflare` and `client_ip_headers CF-Connecting-IP`. The proxy rewrites the client address only for requests that really come from Cloudflare's ranges, and the app keeps trusting only the proxy (P11-05's `TRUSTED_PROXIES` = the Docker network). The app shouldn't read `CF-Connecting-IP` itself: any direct visitor can send that header.
- **Origin reachable directly** (the home IP on 443, or the VPS IP): a visitor who skips Cloudflare still can't spoof the IP, as long as the real-IP rule above trusts only Cloudflare's ranges. But they skip Cloudflare's WAF and limits. Lock the origin: allow 443 only from Cloudflare's IP ranges (router or host firewall), or better, use a Cloudflare Tunnel (`cloudflared`), so no inbound port is open at all. DuckDNS can't be proxied by Cloudflare, so with DuckDNS the home IP is public and the origin is the edge. In that case P11-05's limits and P11-08 carry all the weight.

**Upload size limits must line up:** Cloudflare's free plan refuses request bodies over 100 MB (with a 413 from Cloudflare that the app never sees). Keep `MAX_UPLOAD_BYTES` (default 25 MB) at or under 100 MB, and set the proxy's `client_max_body_size` to the same value instead of `0` (`deploy/swag/disgourd.subdomain.conf.sample:28`). Then an oversized upload is refused early, by the proxy, with the app's own message rule (P11-05).

**Secrets at rest** (new packet P11-14):
- **JWT secret:** `JWT_SECRET` is read from the environment (`config.js:23`). Otherwise the server generates `/config/.jwt-secret`.
- **VAPID keys:** only a file (`push.js:11`, `/config/.vapid.json`), with no environment option.
- **kie.ai key:** `KIEAI_API_KEY` from the environment wins (`kie.js:64`). A key typed into the app is stored in plain text in `site_settings` in the database.
- **Not in the image:** the `.dockerignore` keeps `.jwt-secret`, `.env` and `config.json` out, but not `.vapid.json` (L8).
- **What backups carry:**
  - Nightly `VACUUM INTO` copies and Litestream replicas hold the whole database: password hashes, every DM, and any kie.ai key saved in the app. A Litestream copy sends all of it to R2.
  - They don't hold `.jwt-secret` or `.vapid.json`. Restoring from R2 alone signs everyone out and breaks every push subscription unless those two are backed up separately or come from the environment.
- **Fix (P11-14):**
  - `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` from the environment.
  - A start-up warning when a kie.ai key is stored in the database while `KIEAI_API_KEY` is set (with a one-click "forget the saved key" in Settings).
  - Docs: every secret (JWT, VAPID, kie.ai, and the future SMTP password and R2 keys) comes from the host's environment or a secrets file mounted read-only. The R2 bucket is private, with a token scoped to that bucket. And the restore drill.
  - The SMTP and R2 credentials never go into `site_settings`. That's a rule for the email packet when it's written.

**Container hardening on Unraid** (P11-05, L8):
- Already right: the compose file runs as `99:100`, mounts only `/config` and `/uploads`, and uses a bridge network (`proxynet`), with no `privileged` and no `network_mode: host`.
- To add: `read_only: true` with a tmpfs `/tmp` (the app writes only to the two volumes), `cap_drop: [ALL]` and `no-new-privileges`.
- `ports: 3000:3000` stays LAN-only. Never forward it at the router.
- The uploads share should be its own folder, not a parent of other media.

## Deployment as built (2026-10-21)
The owner deployed on the Unraid box, not a VPS (reported by the hosting session after #210 merged). This is the setup the packets now target; the VPS notes above stay for reference.

- **Front door: a Cloudflare Tunnel.**
  - `cloudflare/cloudflared:latest` runs on the `proxynet` Docker network (`tunnel run`, `TUNNEL_TOKEN` and `NO_AUTOUPDATE=true` from the environment).
  - Two public hostnames: `disgourd.<domain>` → `http://disgourd:3000` and an audiobookshelf hostname.
  - SWAG is no longer in the path, so there's no nginx real-IP module, no proxy body limit and no fail2ban. DisGourd's direct peer is the cloudflared container.
- **DNS and the router:** only those two proxied CNAMEs exist; the DuckDNS, wildcard, root and Matrix records are gone. Every router port forward is removed except Plex 32400 (kept on purpose). Checked from the LAN: only 32400 answers.
- **The DisGourd container:**
  - Built from `/mnt/user/appdata/disgourd-src` (main) with `DOCKER_BUILDKIT=0 docker build`; the compose file is in `/mnt/user/appdata/disgourd-stack/`.
  - It runs as `99:100` with `cap_drop: [ALL]` and `no-new-privileges`, on `proxynet` only, with **no published ports**.
  - Environment: `TRUST_PROXY=1`, `SITE_ADMINS=elldreth`, `REGISTRATION_MODE=closed`. `JWT_SECRET` isn't set, so `/config/.jwt-secret` is used; VAPID is in `/config/.vapid.json`.
  - DB on the cache drive (`/config`), uploads on the array.
- **Updates:** an Unraid User Script runs `git pull --ff-only`, builds, stops, copies the DB, runs `compose up`, and checks health.

**What this changes, finding by finding:**
| Finding | Status in this deployment | Still to do |
|---|---|---|
| C1 (first account) | **Not reachable.** The DB has accounts. | P11-01 still matters for any fresh install (a rebuild from an empty volume, or a second instance), but it's no longer urgent here. |
| H3 (public port, spoofable X-Forwarded-For) | **Mostly closed.** No published port, no router forward, origin reachable only through the tunnel. | With `TRUST_PROXY=1`, the app trusts X-Forwarded-For from *any* peer, and every container on `proxynet` (audiobookshelf, SWAG if still running, anything added later) can reach `disgourd:3000` and send any header. Cloudflare appends the visitor's address to X-Forwarded-For, so the last-hop rule probably already sees the right IP through cloudflared. **Check it on the live box** (P11-05 AC). The repo's `docker-compose.yml` still publishes 3000 for other installs. P11-05 narrows the trust to cloudflared. |
| L8 (container hardening) | **Partly done:** 99:100, `cap_drop: [ALL]`, `no-new-privileges`, no ports, one network, two mounts. | `read_only: true` + tmpfs `/tmp`; pin the `cloudflared` and `node` images to versions; a `DOCKER-USER` rule so the container can't reach the LAN (router, Unraid UI, SMB) except ComfyUI:8188. |
| Origin lock (Hosting setups) | **Done** by the tunnel: there's no origin port to hit. | Nothing. |
| Upload limits | No proxy limit now. Cloudflare's free plan still refuses bodies over 100 MB at the edge. | Keep `MAX_UPLOAD_BYTES` (25 MB default) at or under 100 MB (README note in P11-05). |
| M2 (tokens in URLs) | No SWAG access log now. cloudflared doesn't log request URLs at its default level; Cloudflare terminates TLS, so it sees them either way. | Lower urgency; P11-07 stays, later in the order. |
| M4 (uploads outlive deletion) | **Worse behind Cloudflare.** Cloudflare caches `.jpg`, `.png`, `.mp4` and similar by default. `/uploads` says `public, max-age=31536000, immutable`, so deleted or private images can be served from Cloudflare's edge for a long time. | P11-04 switches to `private` caching. Until then, a Cloudflare Cache Rule: bypass cache for `/uploads/*` (see "Cloudflare settings to do now"). |
| M8 (voice IPs) | Unchanged: STUN-only mesh. TURN can't run through the tunnel (it's UDP); it would need router port forwards, which undoes the "no open ports" setup. | P11-11 now recommends a hosted TURN (for example Cloudflare's TURN service) over self-hosted coturn at home. |
| Secrets (P11-14) | JWT and VAPID live only as files in `/config`, which sits on the cache drive with nightly backups next to it, all on the same box. | P11-14, plus an off-box copy of `/config` (including `.jwt-secret` and `.vapid.json`). |

**Cloudflare settings to do now (dashboard, no code):**
- **A rate-limiting rule** (the free plan allows one): requests to `/login` or `/register`, more than 10 per minute from one IP → block for 10 minutes. This covers the gap until P11-08 adds per-account limits.
- **A Cache Rule:** `/uploads/*` → bypass cache (until P11-04 lands, then it can stay).
- **SSL/TLS:** Always Use HTTPS on; minimum TLS 1.2; HSTS on (max-age 6 months to start, no preload). With no proxy of its own, P11-06 relies on Cloudflare for HSTS.
- **Leave WebSockets on** (the default; `/gateway` needs it).
- **Bot Fight Mode:** test it before leaving it on. It can challenge the app's API calls and the socket.

## Plan: the order to build in
The instance is already public, so this is the order to build in, starting now. **P11-10's push endpoint allowlist is first: it's the go-live blocker** (on the home LAN, it's the one server-side request a member can point at the router, the Unraid UI or SMB). The rest follow in this order, one PR each, starting only when the owner says so.

| Order | ID | Fixes | Title | Size | State |
|---|---|---|---|---|---|
| 1 | P11-10 | M10 (High at home), M5 | **Push endpoint allowlist** (go-live blocker); ComfyUI metadata block | S | READY |
| 2 | P11-02 | H1 | Role hierarchy on the legacy member-tier route | S | READY |
| 3 | P11-03 | H2 | Gateway abuse limits: `read` checks, per-user op rate limits, socket cap, search limit | M | READY |
| 4 | P11-08 | M3 | Sign-in hardening: per-account limits, IPv6 /64, bounded limiter, common passwords (the one thing reachable without an account) | S–M | READY |
| 5 | P11-05 | H3 (rest), L8, L10 | Trust only cloudflared; read-only root; LAN egress rule; pinned images; a tunnel compose sample | S–M | READY |
| 6 | P11-04 | H2, M4 | Upload quotas, cleanup with their messages, private caching (Cloudflare edge) | M | READY |
| 7 | P11-06 | M1 | Security headers, CSP and same-origin CORS (HSTS from Cloudflare) | S–M | READY |
| 8 | P11-14 | Secrets | VAPID and other secrets from the environment; off-box backup of `/config` | S | READY |
| 9 | P11-01 | C1 | First-run setup code; safe `SITE_ADMINS` (for fresh installs) | S | READY |
| 10 | P11-07 | M2 | Session tokens out of URLs | S–M | PLANNED (after P11-03) |
| 11 | P11-09 | M7, M9 | Instance safety: suspend accounts; who can DM me | M | PLANNED (after P11-03 and P11-07) |
| 12 | P11-12 | M6 | Case-insensitive usernames | S–M | PLANNED (after P11-01) |
| 13 | P11-11 | M8 | Voice: TURN from the server (hosted TURN), relay-only option, honour forced mute | M | READY (owner decision 3) |
| 14 | P11-13 | L1–L7, L9 | Low-severity sweep | S–M | PLANNED (last) |

"READY" means its dependencies are met. Nothing starts until the owner says so.

## Serialize
- P11-03, P11-07 and P11-09 all touch `server/gateway/` (`index.js`, `router.js`, `dm.js`). Do them in that order.
- P11-01 and P11-12 both touch registration and username lookups. P11-01 goes first.
- P11-03 and P11-08 can both change `server/auth/rateLimit.js`. Whichever goes second rebases.
- P11-14 goes before P11-13 (both touch `backup.js` and the README's backup section).
- P11-13 goes last.

## Owner decisions
1. **Move-day path: decided.** The Unraid box with a Cloudflare Tunnel (see "Deployment as built"). For the record, the question was: VPS (A) or the Unraid box (B)? For A: copy the existing `/config` (DB, `.jwt-secret`, `.vapid.json`) to the VPS, or start empty? Copying avoids C1 on day one, and push subscriptions keep working only if `.vapid.json` moves too. For B: the data stays, so C1 doesn't apply. The "Hosting setups" section matters more, though (LAN egress, origin lock, real IP).
2. **DM default (P11-09):** recommended "friends and people I share a server with".
3. **Voice (P11-11):** use a hosted TURN service (nothing opened at home), or keep STUN only and accept IP exposure among people in a call? Self-hosted coturn at home would need router port forwards again. Recommended: hosted TURN, relay-only off by default.
4. **Registration:** it's `closed` today. If it opens up, use `code` (per-person codes with a use limit), never `open`.

## Verification Evidence
| Item | Status | Evidence |
|---|---|---|
| Code read | Done | `server/` (all routes, gateway ops, auth, net, imagine engines, db access paths), `web/src` (markdown, embeds, api/token, socket, voice, sw.js), Dockerfile, docker-compose.yml, `deploy/` |
| C1, H1, H2 reproduced | Done | `.dev/security/p11-00-proof.js` against an in-memory DB (NODE_ENV=test, random port; not the real DB, not :3000). Output: `C1 first register while closed -> 201 siteAdmin = true`; `H1 roles API (should refuse) -> 403` then `H1 legacy PATCH -> 200 \| after: edit_server = true ban = true`; `H2 read_state after 20 frames: 20 rows, 4.7 MB`. |
| npm audit | Done | server/: 0 in production, 6 in dev (3 high, 3 moderate, the Jest chain). web/: 0 in production, 1 dev (vite / launch-editor). |
| App code changed | None | Packets and the proof script only |
| kie.ai spend | 0 | Nothing was generated |

## Discovered Work (recorded, not planned)
- TOTP two-factor for site admins (and optionally everyone).
- Email verification and a secure password reset, once the email provider is chosen (the other session's research). Today email isn't verified, and there's no reset.
- Signed, expiring upload URLs, or a separate origin for user content.
- An SFU for voice (real server-side mute, no peer IPs, better for large calls).
- `url.parse()` deprecation (DEP0169) in `http/handler.js` and `gateway/index.js`. Move to the WHATWG URL parser; it's not a vulnerability here, since paths are re-checked.
