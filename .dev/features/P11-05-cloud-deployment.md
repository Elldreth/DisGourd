# P11-05 — Behind the Cloudflare Tunnel: trust only cloudflared, read-only root, LAN egress rule, pinned images

- **Unit Type:** Implementation (child of P11-00)
- **Phase:** 11
- **State:** COMPLETE (merged in #219; the owner is applying the Unraid steps from deploy/unraid-tunnel/README.md, which cover AC-4 and AC-5)
- **Effort:** S–M
- **Depends on:** none
- **Serialize with:** P11-06 (both touch the deploy docs). P11-08 if it changes `auth/rateLimit.js` first.
- **Requirement Source:** P11-00 findings H3 (the part left after the tunnel), L8, L10, and "Deployment as built (2026-10-21)".

## Where things stand (the live Unraid deployment)
**Already done by the deployment:**
- The Cloudflare Tunnel (`cloudflared` on `proxynet`) is the only way in. No published ports, no router forwards for DisGourd, and no DuckDNS. Locking the origin to Cloudflare is done.
- The container runs as `99:100` with `cap_drop: [ALL]` and `no-new-privileges`, on one network, with two mounts (`/config`, `/uploads`), no `privileged` and no host network.

**Still to do (this packet):**
1. **Trust only cloudflared.** `TRUST_PROXY=1` makes `clientIp` (`server/auth/rateLimit.js:29-38`) trust `X-Forwarded-For` from *any* peer.
   - Every container on `proxynet` (audiobookshelf, SWAG if it still runs, anything added later) can reach `disgourd:3000` and send any `X-Forwarded-For` or `CF-Connecting-IP`.
   - `server/static.js:38` trusts `X-Forwarded-Host` / `-Proto` even without TRUST_PROXY.
2. **Check the client IP the app sees through the tunnel.** Cloudflare appends the visitor's address to `X-Forwarded-For` and sets `CF-Connecting-IP` to it, so the last-hop rule is probably right today. It hasn't been checked on the live box, though, and it's what every rate limit rests on.
3. **`read_only: true`** + tmpfs `/tmp` on the DisGourd container.
4. **A LAN egress rule.** A compromised container can reach the router, the Unraid UI and SMB. Only ComfyUI:8188 (and DNS) should be reachable.
5. **Pinned images.** `cloudflare/cloudflared:latest` and `node:22-bookworm-slim` move under you; pin versions and update on purpose.
6. **Repo samples.** The repo's `docker-compose.yml` still publishes `3000:3000` with `TRUST_PROXY=1` (fine on a LAN, wrong anywhere public), and there's no sample of the tunnel setup that's actually running.

## Scope
- **`TRUSTED_PROXIES`:** a comma-separated list of CIDRs. `TRUST_PROXY=1` keeps working (loopback plus the private ranges) but logs a one-time hint to set `TRUSTED_PROXIES`.
  - `clientIp` reads forwarding headers only when `req.socket.remoteAddress` is in the list.
  - **`CLIENT_IP_HEADER=cf-connecting-ip`:** when set and the peer is trusted, the address is that header (a single value Cloudflare sets and a visitor can't). Otherwise it's the right-most `X-Forwarded-For` hop that isn't a trusted proxy.
  - `originFor` reads `X-Forwarded-Host` / `-Proto` only from a trusted peer.
- **A network only cloudflared shares:**
  - Put DisGourd on its own Docker network (for example `disgourd-edge`, a fixed subnet such as `172.30.80.0/24`). Only `cloudflared` joins it as well; cloudflared stays on `proxynet` for audiobookshelf.
  - Set `TRUSTED_PROXIES` to that subnet.
  - Then no other container can reach `disgourd:3000` at all. In the tunnel's public hostname, `http://disgourd:3000` keeps working, because cloudflared resolves it on the shared network.
- **A site-admin check:** `GET /admin/client-ip` returns `{ ip, peer, via: 'cf-connecting-ip' | 'x-forwarded-for' | 'socket', trusted }`, for checking the live setup from a phone on mobile data. Site admins only. Add it to `web/devProxy.js`.
- **`deploy/unraid-tunnel/`** (new; mirrors the live setup, no secrets):
  - **`docker-compose.yml`:**
    - `disgourd`: `user: 99:100`, `read_only: true`, `tmpfs: [/tmp]`, `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, no `ports:`, the `disgourd-edge` network, the two volumes, log rotation (`max-size: 10m`), and the env `TRUSTED_PROXIES` + `CLIENT_IP_HEADER=cf-connecting-ip` + `REGISTRATION_MODE=closed`.
    - `cloudflared`: a pinned version tag, `tunnel run`, `TUNNEL_TOKEN` from an env file, `NO_AUTOUPDATE=true`, and both networks.
  - **`README.md`:**
    - The Cloudflare public hostname (`http://disgourd:3000`) and the dashboard settings from P11-00 ("Cloudflare settings to do now": the login rate-limit rule, the `/uploads/*` cache bypass, HTTPS and HSTS, leaving WebSockets on).
    - Building with `DOCKER_BUILDKIT=0 docker build` (Unraid's buildx is too old for `compose --build`).
    - Upload limits: no proxy body limit; Cloudflare refuses bodies over 100 MB on the free plan, so keep `MAX_UPLOAD_BYTES` at or under that (25 MB default).
    - How to update the pinned images.
  - **`update.sh`:** the owner's User Script, cleaned up (git pull `--ff-only`, build, stop, copy the DB, up, wait for healthy, roll back to the previous image tag if the check fails). Optional: include it only if the owner shares it.
- **The LAN egress rule** (in that README, as an Unraid User Script "At Startup of Array"):
  - `iptables -I DOCKER-USER` rules for traffic from `disgourd-edge`: first `RETURN` for `ESTABLISHED,RELATED`, then `ACCEPT` to the ComfyUI host on tcp/8188 and to the router on 53, then `DROP` to the LAN subnet (for example `192.168.1.0/24`) and the other private ranges outside Docker's own.
  - Traffic inside the `disgourd-edge` network and out to the internet stays allowed.
  - The README says how to check it (below) and how to remove it.
- **The repo's `docker-compose.yml`** (the old SWAG setup): comment it as the LAN/SWAG example, mark `ports:` "LAN only; never forward it at the router", and add `read_only` + tmpfs and `cap_drop`. `deploy/swag/` gets a note that the live setup uses the tunnel.
- **Dockerfile:** pin the runtime base by digest, with a comment on updating it. `.dockerignore` adds `**/.vapid.json`.

## Acceptance criteria
- [x] AC-1 (unit): with `TRUSTED_PROXIES=172.30.80.0/24` and `CLIENT_IP_HEADER=cf-connecting-ip`:
  - A request from `172.30.80.5` with `CF-Connecting-IP: 198.51.100.7` is limited as 198.51.100.7.
  - The same headers from `172.18.0.9` (another container) are limited as 172.18.0.9.
  - Without `CLIENT_IP_HEADER`, the right-most untrusted X-Forwarded-For hop is used.
- [x] AC-2: `TRUST_PROXY=1` alone still behaves as today, and the existing tests pass.
- [x] AC-3: `X-Forwarded-Host` from an untrusted peer doesn't change the og:image origin.
- [ ] AC-4 (owner, live, by the owner or the hosting session): `GET /admin/client-ip` from a phone on mobile data shows the phone's public IP, via `cf-connecting-ip`, `trusted: true`. From another container on `proxynet` (for example `docker exec audiobookshelf wget -qO- http://disgourd:3000/auth-info`), the connection fails once DisGourd is off `proxynet`.
- [ ] AC-5 (owner, live): DisGourd starts and runs with `read_only: true` (login, upload, a link preview, a backup). Inside the container, `node -e "fetch('http://<router-ip>').then(()=>console.log('open'),()=>console.log('blocked'))"` prints `blocked`, and the same for the ComfyUI host:8188 prints `open`.
- [~] AC-6 (partly: no Docker here; CI runs the smoke test): `docker compose -f deploy/unraid-tunnel/docker-compose.yml config` validates. `deploy/docker-smoke.sh` passes with `read_only` and the pinned image.
- [x] AC-7: both suites pass.

## As built
- **`server/net/clientIp.js`** (new, with no dependencies, so `static.js` can use it without the database). `proxyTrust` holds `enabled`, `cidrs` and `header`, read from `TRUST_PROXY`, `TRUSTED_PROXIES` (which implies trust) and `CLIENT_IP_HEADER`.
  - `clientIpVia(req)` returns `{ ip, peer, via, trusted }`. Forwarding headers count only when the socket peer is in `TRUSTED_PROXIES`, or, with just `TRUST_PROXY=1`, when it's a loopback or private address. Then:
    - `CLIENT_IP_HEADER` wins if it holds an address;
    - else the right-most `X-Forwarded-For` hop that isn't itself a trusted proxy (a junk hop stops the walk).
  - `::ffff:a.b.c.d` peers match IPv4 ranges.
  - A typo in `TRUSTED_PROXIES` throws at start, so the server never trusts too much or too little by accident.
- **`config.trustProxy`** is now a getter/setter onto `proxyTrust.enabled`, so existing code and tests that flip it still work. `config.json`'s `trustProxy` is still honoured.
- **`auth/rateLimit.clientIp`** is the new one, and every rate limit uses it.
- **`static.originFor`** reads `X-Forwarded-Host` / `-Proto` only from a trusted proxy.
- **`GET /admin/client-ip`** (site admins) returns what the server sees, plus the trust settings. `/admin` is already in `web/devProxy.js`.
- **Start-up hint:** with `TRUST_PROXY=1` and no `TRUSTED_PROXIES`, the banner suggests narrowing it.
- **`deploy/unraid-tunnel/`** (new), mirroring the live setup with no secrets:
  - **`docker-compose.yml`:**
    - DisGourd: 99:100, read-only, tmpfs `/tmp`, `cap_drop: ALL`, `no-new-privileges`, no ports, `TRUSTED_PROXIES=172.30.80.0/24`, `CLIENT_IP_HEADER=cf-connecting-ip`, log rotation, only on `disgourd-edge`.
    - cloudflared: pinned `2026.10.2@sha256:0e56c13c…93b2`, on `disgourd-edge` and `proxynet`.
    - `disgourd-edge` is external, created once with a fixed subnet.
  - **`egress.sh`:** a `DISGOURD-EGRESS` chain hooked from `DOCKER-USER` for traffic from `disgourd-edge`. It allows replies, its own subnet and ComfyUI:8188; it drops the LAN, `10/8`, `172.16/12`, `192.168/16`, `100.64/10` and `169.254/16`. It's idempotent, and `./egress.sh remove` undoes it.
  - **`README.md`:** the Cloudflare settings (the owner's Sign-in limit and No cache for uploads rules, Always HTTPS, TLS 1.2, HSTS 1 month with includeSubDomains), the 100 MB edge cap, and numbered move steps with undo for each.
- **Repo `docker-compose.yml`** (the SWAG/LAN example): read-only, tmpfs, `cap_drop`, `no-new-privileges`, "LAN only, never forward" on `ports:`, and a pointer to the tunnel sample.
- **Dockerfile:** both stages pinned by digest (`node:22-bookworm@sha256:69a5…4088`, `node:22-bookworm-slim@sha256:3ed9…dbe9`, looked up from Docker Hub on 2026-10-21), with how to update.
- **`.dockerignore`:** adds `**/.vapid.json` and `**/.setup-code`.
- **`deploy/docker-smoke.sh`:** runs the image with `--read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges:true`, so CI proves the read-only setup.

**Behaviour change:** `TRUST_PROXY=1` alone used to trust `X-Forwarded-For` from any peer. Now it trusts only loopback and private peers. Behind SWAG or cloudflared on a Docker network that's the same result; a public peer can no longer spoof it.

## Verification Evidence
| Acceptance Criterion | Status | Verification Type | Evidence |
|---|---|---|---|
| AC-1 | Verified | Jest `client-ip.test.js` + sandbox | From 172.30.80.5, `CF-Connecting-IP` wins; from 172.18.0.9 (another network) its own address counts; an IPv4-mapped peer matches. Without the header: right-most untrusted hop, spoofed left hops ignored. Sandbox (`app-sandbox-trust`, trusted = loopback): `CF-Connecting-IP: 198.51.100.7` with a spoofed XFF gave `198.51.100.7 via cf-connecting-ip`. The same request over the PC's LAN address (10.0.0.149, untrusted) gave `10.0.0.149 via socket, trusted false` |
| AC-2 | Verified | Jest | `TRUST_PROXY=1` alone trusts private and loopback peers (a SWAG-like 172.18.x peer gets the forwarded IP; a public peer doesn't). The existing `api.test.js` 0.4 case passes unchanged |
| AC-3 | Verified | Jest `shareMeta.test.js` + sandbox | `X-Forwarded-Host` is honoured from 172.18.0.4 with trust on, and ignored from 203.0.113.9, or with trust off. Sandbox: the trusted peer's `X-Forwarded-Host: chat.example.org` → `https://chat.example.org/og-image.png` |
| AC-4 | Owner, live | README step 4 | The route and its console check work in the sandbox (`via: socket` for a direct visit). The live check (`via: cf-connecting-ip`, and `audiobookshelf` can't reach `disgourd:3000`) is for after the owner's steps 2–3 |
| AC-5 | Owner, live | README step 5 | Read-only is proven by CI's smoke run (`--read-only`). The egress rule's `blocked` / `open` checks are for the owner on the Unraid box; `egress.sh` passes `bash -n` |
| AC-6 | Partly | PyYAML + CI | Both compose files parse (services, networks, `read_only`, no ports on the tunnel one). There's no Docker on this PC for `docker compose config`; CI's smoke job builds the pinned image and runs it read-only |
| AC-7 | Verified | Jest, Vitest | Server 60 suites / 537 tests; web 107 files / 844 tests |

## Discovered Work (not done here)
- **A cloudflared template loses the network:** if cloudflared stays an Unraid template container, a template edit drops its `disgourd-edge` connection (README step 2 says how to handle that). Moving it into the stack avoids this.
- **HSTS** comes only from Cloudflare. A visit straight to `http://<unraid-ip>:3000` on the LAN isn't affected (and the tunnel setup publishes no port).

## Expected Areas of Change
`server/auth/rateLimit.js`, `server/config.js`, `server/static.js`, `server/routes/admin.js` (client-ip), `web/devProxy.js`, `deploy/unraid-tunnel/` (new), `docker-compose.yml` (comments, hardening), `deploy/swag/` (a note), `Dockerfile`, `.dockerignore`, `README.md`, tests (`server/tests/clientIp.test.js` new, `static.test.js`, admin route test).

## Not in scope
- A VPS setup: the `deploy/cloud/` sample from the first plan is dropped while the tunnel setup is the one in use.
- fail2ban: per-account limits (P11-08) and the Cloudflare rate-limit rule cover it.

## Follow-up after the live setup (2026-10-21)
The owner applied the steps on Unraid. Everything checked out:
- `/admin/client-ip` showed the real IPv6, peer `172.30.80.2`, via `cf-connecting-ip`, `trusted: true`.
- The `audiobookshelf` wget got "bad address".
- From DisGourd, the router and the Unraid UI were blocked; ComfyUI and api.kie.ai were open.

Running it surfaced three gaps, now fixed in `deploy/unraid-tunnel/egress.sh` and its README:
- **The host itself:** traffic from the container to the Unraid host goes through `INPUT`, not `DOCKER-USER`, so the host UI stayed reachable. `egress.sh` now also drops new connections from `disgourd-edge` in `INPUT` (and `remove` deletes that rule). The README checks include the host's own IP.
- **Start order:** Unraid can run the User Script before Docker has made `DOCKER-USER`, so the script waits up to 60 × 2 s for it.
- **The tunnel's name:** the tunnel container's name is a variable (`TUNNEL`; the owner's template calls it `Unraid-Cloudflared-Tunnel`). The script re-runs `docker network connect disgourd-edge "$TUNNEL"` each time, so a re-created template container gets its network back.
