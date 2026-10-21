# P11-05 — Behind the Cloudflare Tunnel: trust only cloudflared, read-only root, LAN egress rule, pinned images

- **Unit Type:** Implementation (child of P11-00)
- **Phase:** 11
- **State:** READY (build order 5 in P11-00; start only when the owner says so)
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
- [ ] AC-1 (unit): with `TRUSTED_PROXIES=172.30.80.0/24` and `CLIENT_IP_HEADER=cf-connecting-ip`:
  - A request from `172.30.80.5` with `CF-Connecting-IP: 198.51.100.7` is limited as 198.51.100.7.
  - The same headers from `172.18.0.9` (another container) are limited as 172.18.0.9.
  - Without `CLIENT_IP_HEADER`, the right-most untrusted X-Forwarded-For hop is used.
- [ ] AC-2: `TRUST_PROXY=1` alone still behaves as today, and the existing tests pass.
- [ ] AC-3: `X-Forwarded-Host` from an untrusted peer doesn't change the og:image origin.
- [ ] AC-4 (live, by the owner or the hosting session): `GET /admin/client-ip` from a phone on mobile data shows the phone's public IP, via `cf-connecting-ip`, `trusted: true`. From another container on `proxynet` (for example `docker exec audiobookshelf wget -qO- http://disgourd:3000/auth-info`), the connection fails once DisGourd is off `proxynet`.
- [ ] AC-5 (live): DisGourd starts and runs with `read_only: true` (login, upload, a link preview, a backup). Inside the container, `node -e "fetch('http://<router-ip>').then(()=>console.log('open'),()=>console.log('blocked'))"` prints `blocked`, and the same for the ComfyUI host:8188 prints `open`.
- [ ] AC-6: `docker compose -f deploy/unraid-tunnel/docker-compose.yml config` validates. `deploy/docker-smoke.sh` passes with `read_only` and the pinned image.
- [ ] AC-7: both suites pass.

## Expected Areas of Change
`server/auth/rateLimit.js`, `server/config.js`, `server/static.js`, `server/routes/admin.js` (client-ip), `web/devProxy.js`, `deploy/unraid-tunnel/` (new), `docker-compose.yml` (comments, hardening), `deploy/swag/` (a note), `Dockerfile`, `.dockerignore`, `README.md`, tests (`server/tests/clientIp.test.js` new, `static.test.js`, admin route test).

## Not in scope
- A VPS setup: the `deploy/cloud/` sample from the first plan is dropped while the tunnel setup is the one in use.
- fail2ban: per-account limits (P11-08) and the Cloudflare rate-limit rule cover it.
