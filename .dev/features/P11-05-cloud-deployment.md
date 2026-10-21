# P11-05 — Cloud deployment: trusted proxies, no public app port, proxy sample, container hardening

- **Unit Type:** Implementation (child of P11-00)
- **Phase:** 11
- **State:** READY
- **Effort:** S–M
- **Depends on:** none. The host choice (the other session's research) only changes the sample's comments, not the code.
- **Serialize with:** P11-06 (it adds header lines to the proxy sample written here)
- **Requirement Source:** P11-00 findings H3, L8, L10.

## Problem
- `docker-compose.yml:46` publishes `3000:3000` on every interface, and `:30` sets `TRUST_PROXY=1`. On a cloud VM, Docker's port rules skip ufw and firewalld, so `:3000` is open to the internet over plain HTTP.
- `server/auth/rateLimit.js:29-38` trusts `X-Forwarded-For` from any peer when TRUST_PROXY is on. Sending a new header each time skips the login and registration limits.
- `server/static.js:38` trusts `X-Forwarded-Host` / `-Proto` without TRUST_PROXY.

## Scope
- **`TRUSTED_PROXIES`:** a comma-separated list of CIDRs; `TRUST_PROXY=1` keeps working and means loopback plus the private ranges.
  - `clientIp` uses `X-Forwarded-For` only when `req.socket.remoteAddress` is in the list. It then walks the hops from the right and takes the first that isn't a trusted proxy.
  - `originFor` reads `X-Forwarded-*` only from a trusted peer.
- **`deploy/cloud/`:**
  - **`docker-compose.yml`:** the app with no `ports:`, or `127.0.0.1:3000:3000` with a comment. Also `read_only: true` with tmpfs `/tmp`, `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, `restart: unless-stopped`, log rotation (`max-size`), and a reverse proxy service (Caddy recommended for automatic TLS; an nginx variant is fine).
  - **`Caddyfile`** (or nginx conf):
    - TLS, HSTS (`max-age=31536000; includeSubDomains`), and WebSocket pass-through.
    - `client_max_body_size` or `request_body max` matching `MAX_UPLOAD_BYTES`.
    - A per-IP connection and request limit.
    - Access logs that drop the query string (`/gateway?token=` until P11-07 lands).
  - **`README.md`:** a firewall checklist (only 22, 80 and 443 open; SSH by key), how to copy `/config` from the Unraid box (DB, `.jwt-secret`, `.vapid.json`, backups), `REGISTRATION_MODE=code`, `KIEAI_API_KEY` in the environment rather than the app, and ComfyUI over a tunnel (P11-10).
- **The existing Unraid compose file** (setup B, the home server):
  - A comment on the `ports:` line: "LAN only; never forward it at the router".
  - Add `read_only: true` + tmpfs `/tmp`, `cap_drop: [ALL]` and `no-new-privileges`. Keep `user: 99:100`, the two mounts, and the bridge network (no `privileged`, no `network_mode: host`).
- **Behind Cloudflare** (both setups; see P11-00 "Hosting setups"):
  - The proxy samples restore the real client IP from `CF-Connecting-IP` only for requests from Cloudflare's published ranges: the nginx real-IP module for SWAG (or linuxserver's `swag-cloudflare-real-ip` mod), and `trusted_proxies cloudflare` + `client_ip_headers CF-Connecting-IP` for Caddy.
  - The app never reads `CF-Connecting-IP` itself.
  - The README explains locking the origin: allow 443 only from Cloudflare's ranges at the router or host firewall, or use a Cloudflare Tunnel with no inbound port. It also says that DuckDNS means no Cloudflare in front.
- **Upload limits line up:** the proxy body limit equals `MAX_UPLOAD_BYTES` (both samples, including the SWAG one, which says `client_max_body_size 0` today). The README says to keep it at or under 100 MB behind Cloudflare's free plan.
- **LAN egress (setup B):** a README section with a `DOCKER-USER` iptables rule (or a VLAN or custom network) that drops traffic from DisGourd's Docker network to the LAN, except the ComfyUI host:8188 and DNS. So even a compromised container can't reach the router, the Unraid UI or SMB. In setup A, the Tailscale ACL in P11-10 does this job.
- **Dockerfile:** pin the runtime base by digest, with a comment on how to update it. Add `**/.vapid.json` to `.dockerignore`.

## Acceptance criteria
- [ ] AC-1: with `TRUSTED_PROXIES=10.0.0.0/8`, a request from 203.0.113.9 carrying `X-Forwarded-For: 1.2.3.4` is limited as 203.0.113.9; the same request from 10.0.0.2 is limited as 1.2.3.4.
- [ ] AC-2: `TRUST_PROXY=1` alone still works behind SWAG (the existing tests and the Unraid setup are unchanged).
- [ ] AC-3: `X-Forwarded-Host` from an untrusted peer doesn't change the og:image origin.
- [ ] AC-4: `docker compose -f deploy/cloud/docker-compose.yml config` validates. The container starts with `read_only` (the data folders are volumes, and nothing else is written). `deploy/docker-smoke.sh` passes against the pinned image.
- [ ] AC-5: both suites pass.
- [ ] AC-6: the SWAG sample's body limit matches `MAX_UPLOAD_BYTES`, and its real-IP lines trust only Cloudflare's ranges. A request that carries `CF-Connecting-IP` but doesn't come from Cloudflare keeps its own address (checked with `nginx -t` and a curl, or described step by step if no SWAG is at hand).
- [ ] AC-7: the Unraid compose file still starts on the sandbox setup with `read_only` and `cap_drop` (`deploy/docker-smoke.sh` runs it as 99:100).

## Expected Areas of Change
`server/auth/rateLimit.js`, `server/config.js`, `server/static.js`, `deploy/cloud/` (new), `docker-compose.yml` (comment), `Dockerfile`, `.dockerignore`, `README.md`, tests (`server/tests/clientIp.test.js` new, `static.test.js`).

## Not in scope
Choosing the host or the email provider. Terraform or other provisioning.
