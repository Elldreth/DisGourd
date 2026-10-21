# DisGourd on Unraid behind a Cloudflare Tunnel

This is the live setup (P11-00, "Deployment as built"):
- `cloudflared` runs a Cloudflare Tunnel. DisGourd has **no published ports** and the router forwards nothing to it.
- The container runs as `99:100`, with no capabilities and a read-only root.
- Only cloudflared can reach DisGourd, over its own Docker network `disgourd-edge`. DisGourd trusts forwarding headers from that network only.
- A host firewall rule keeps DisGourd off the rest of the LAN, except ComfyUI.

Files here:
- `docker-compose.yml`: DisGourd plus cloudflared.
- `egress.sh`: the LAN egress rule.

## Cloudflare settings (dashboard)
These are already set on the live zone (2026-10-21):
- **Public hostname:** `disgourd.<your-domain>` → `http://disgourd:3000`. cloudflared finds `disgourd` by name on `disgourd-edge`.
- **Rate-limiting rule "Sign-in limit":** `(http.request.method eq "POST" and http.request.uri.path in {"/login" "/register"})`, 5 requests per 10 s per IP, then Block for 10 s. This is the free plan's one rate-limit rule. The app adds its own per-account and per-/64 limits behind it (P11-08).
- **Cache rule "No cache for DisGourd uploads":** `(http.host eq "disgourd.<your-domain>" and starts_with(http.request.uri.path, "/uploads/"))` → Bypass cache. Otherwise Cloudflare caches images at its edge, and deleted ones stay served from there.
- **SSL/TLS:** Always Use HTTPS on; minimum TLS 1.2; HSTS on (max-age 1 month, includeSubDomains, no preload, nosniff). DisGourd has no proxy of its own here, so HSTS comes from Cloudflare.
- **WebSockets:** on (the default). `/gateway` needs it.

**Upload size:** Cloudflare's free plan refuses request bodies over 100 MB at its edge, and there's no proxy limit in between now. Keep `MAX_UPLOAD_BYTES` (25 MB by default) at or under 100 MB.

## Moving the existing stack to this setup
The steps assume:
- the source is at `/mnt/user/appdata/disgourd-src`;
- your compose file is in `/mnt/user/appdata/disgourd-stack/`;
- the LAN is `192.168.1.0/24`, with ComfyUI at `192.168.1.20:8188`. Check yours with `ip route` and adjust `egress.sh`.

**1. Deploy the new image first** (your update script: pull, build, restart). The new settings below are only understood by this version. Nothing changes until step 3, because `TRUST_PROXY=1` still behaves as before.

**2. Create the network, and put cloudflared on it.** Both are harmless while DisGourd is still on `proxynet`.
```bash
docker network create --subnet 172.30.80.0/24 disgourd-edge
docker network connect disgourd-edge cloudflared
```
- If cloudflared is an Unraid template container, a template edit or update recreates it and drops this connection. Either add the `connect` line to the User Script in step 5 (it's harmless to repeat), or move cloudflared into the stack (the `cloudflared:` service in `docker-compose.yml`, with `TUNNEL_TOKEN` in a `.env` file, chmod 600) and remove the template container.
- Undo: `docker network disconnect disgourd-edge cloudflared && docker network rm disgourd-edge` (after step 3's undo).

**3. Change the DisGourd service in your stack's compose file** to match `docker-compose.yml` here:
```yaml
    read_only: true
    tmpfs:
      - /tmp
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    environment:
      # remove TRUST_PROXY=1 (TRUSTED_PROXIES replaces it), add:
      - TRUSTED_PROXIES=172.30.80.0/24
      - CLIENT_IP_HEADER=cf-connecting-ip
    networks:
      - disgourd-edge          # instead of proxynet
# and at the bottom:
networks:
  disgourd-edge:
    external: true
    name: disgourd-edge
```
Then, from the stack folder, run `docker compose up -d`.
- Undo:
  - Put `networks: [proxynet]` and `TRUST_PROXY=1` back.
  - Remove `TRUSTED_PROXIES` and `CLIENT_IP_HEADER`.
  - Run `docker compose up -d` again.
  - If something can't write, remove just `read_only: true` and the `tmpfs` lines. That shouldn't happen: it only writes `/config`, `/uploads` and `/tmp`, and CI runs the image this way.

**4. Check it.**
- **What address the server sees:**
  1. Signed in as `elldreth` at `https://disgourd.<your-domain>` in a desktop browser, open the developer console (F12).
  2. Run:
     ```js
     fetch('/admin/client-ip', { headers: { Authorization: 'Bearer ' + localStorage.getItem('disgourd.token') } }).then((r) => r.json()).then(console.log)
     ```
  3. Expect your home's public IP (the request still goes through Cloudflare), `via: "cf-connecting-ip"` and `trusted: true`.
- **From another container,** this should fail (no route):
  ```bash
  docker exec audiobookshelf wget -qO- -T 5 http://disgourd:3000/auth-info
  ```
- **The site,** sign-in, an upload and a link preview all work as before.

**5. The LAN egress rule.**
- Copy `egress.sh` to the server and set `LAN` and `COMFY` at the top.
- Add it as an Unraid User Script "At Startup of Array". Add the `docker network connect` line from step 2 to the same script if cloudflared is a template container.
- Run it once now.
- Check from inside DisGourd:
  ```bash
  docker exec disgourd node -e "fetch('http://192.168.1.1').then(()=>console.log('open'),()=>console.log('blocked'))"
  docker exec disgourd node -e "fetch('http://192.168.1.20:8188').then(()=>console.log('open'),()=>console.log('blocked'))"
  ```
  The first should print `blocked`; the second `open` (if ComfyUI is running).
- Undo: run `./egress.sh remove`, and disable the User Script.

**6. Pin cloudflared** (optional, recommended).
- Use `cloudflare/cloudflared:2026.10.2@sha256:0e56c13c…93b2` (the full value is in `docker-compose.yml`) instead of `:latest`.
- To update later: check https://github.com/cloudflare/cloudflared/releases, `docker pull cloudflare/cloudflared:<new tag>`, then `docker inspect --format '{{index .RepoDigests 0}}' cloudflare/cloudflared:<new tag>` and paste it in.
- Undo: back to `:latest`.

## Backups
`/config` holds the database, its nightly backups (`/config/backups`), `.jwt-secret` and `.vapid.json`. Copy it off the box regularly; P11-14 covers secrets from the environment and off-site copies.
