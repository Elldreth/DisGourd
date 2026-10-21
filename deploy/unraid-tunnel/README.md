# Recipe: DisGourd on Unraid behind a Cloudflare Tunnel

An optional setup:
- A Cloudflare Tunnel (`cloudflared`) is the only way in. DisGourd has **no published ports**, and the router forwards nothing to it.
- The container runs as `99:100` (Unraid's nobody:users), with no capabilities and a read-only root.
- Only the tunnel container can reach DisGourd, over its own Docker network `disgourd-edge`. DisGourd trusts forwarding headers from that network only.
- A host firewall rule (`egress.sh`) keeps DisGourd off the rest of the LAN and off the Unraid host, except ComfyUI.

Files here:
- `docker-compose.yml`: DisGourd plus cloudflared.
- `egress.sh`: the LAN egress rule.

Keep your real values (domain, token, IPs, container names) in the repo's `local/` folder, which git ignores, not in these files.

## Change these
| Placeholder | What to put there | Where |
|---|---|---|
| `disgourd.your-domain.example` | the hostname you publish | Cloudflare, and the checks below |
| `/mnt/user/appdata/disgourd-src` | where you cloned the repo | `docker-compose.yml`, steps below |
| `/mnt/cache/appdata/disgourd` | the database folder (fast local disk / cache) | `docker-compose.yml` |
| `/mnt/user/your-share/disgourd-uploads` | the uploads folder | `docker-compose.yml` |
| `YOUR_TUNNEL_CONTAINER` | the tunnel container's name (`cloudflared` if you use this compose file; an Unraid template may name it differently) | the commands below, `TUNNEL` in `egress.sh` |
| `YOUR_OTHER_CONTAINER` | any other container on your proxy network, for a check | step 4 |
| `192.168.1.0/24`, `192.168.1.1`, `192.168.1.10`, `192.168.1.20` | your LAN, router, Unraid host, ComfyUI machine (`ip route` on the Unraid box) | `egress.sh`, step 5 |
| `TUNNEL_TOKEN` | the tunnel's token (Cloudflare Zero Trust → Networks → Tunnels) | a `.env` next to `docker-compose.yml` (chmod 600) |

## Cloudflare settings (dashboard)
- **Public hostname:** `disgourd.your-domain.example` → `http://disgourd:3000`. The tunnel finds `disgourd` by name on `disgourd-edge`.
- **Rate-limiting rule** (the free plan allows one): `(http.request.method eq "POST" and http.request.uri.path in {"/login" "/register"})`, 5 requests per 10 s per IP, then Block for 10 s. The app adds its own per-account and per-/64 limits behind it.
- **Cache rule:** `(http.host eq "disgourd.your-domain.example" and starts_with(http.request.uri.path, "/uploads/"))` → Bypass cache. The app also marks uploads private, but this keeps Cloudflare from caching them at its edge in any case.
- **SSL/TLS:** Always Use HTTPS on; minimum TLS 1.2; HSTS on (start with max-age 1 month, includeSubDomains, no preload, nosniff). There's no proxy of your own here, so HSTS comes from Cloudflare.
- **WebSockets:** on (the default). `/gateway` needs it.

**Upload size:** Cloudflare's free plan refuses request bodies over 100 MB at its edge. Keep `MAX_UPLOAD_BYTES` (25 MB by default) at or under that.

## Steps (moving an existing DisGourd onto this setup)
**1. Deploy a DisGourd version that has P11-05** (`TRUSTED_PROXIES`). Nothing changes until step 3.

**2. Create the network, and put the tunnel on it.** This is harmless while DisGourd is still on its old network.
```bash
docker network create --subnet 172.30.80.0/24 disgourd-edge
docker network connect disgourd-edge YOUR_TUNNEL_CONTAINER
```
- If the tunnel is an Unraid template container, a template edit or update recreates it and drops this connection. `egress.sh` (step 5) reconnects it every time it runs, so set `TUNNEL` there. Or run the `cloudflared:` service from `docker-compose.yml` instead.
- Undo: `docker network disconnect disgourd-edge YOUR_TUNNEL_CONTAINER && docker network rm disgourd-edge` (after step 3's undo).

**3. Change the DisGourd service** to match `docker-compose.yml` here:
```yaml
    read_only: true
    tmpfs:
      - /tmp
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    environment:
      # remove TRUST_PROXY=1 if you had it (TRUSTED_PROXIES replaces it), add:
      - TRUSTED_PROXIES=172.30.80.0/24
      - CLIENT_IP_HEADER=cf-connecting-ip
    networks:
      - disgourd-edge          # instead of your old network
# and at the bottom:
networks:
  disgourd-edge:
    external: true
    name: disgourd-edge
```
Then run `docker compose up -d`.
- Undo:
  - Put your old network and `TRUST_PROXY=1` back.
  - Remove `TRUSTED_PROXIES` and `CLIENT_IP_HEADER`.
  - Run `docker compose up -d` again.
  - If something can't write, remove just `read_only: true` and the `tmpfs` lines. That shouldn't happen: it only writes `/config`, `/uploads` and `/tmp`, and CI runs the image this way.

**4. Check it.**
- **What address the server sees:**
  1. Signed in as a site admin at `https://disgourd.your-domain.example` in a desktop browser, open the developer console (F12).
  2. Run:
     ```js
     fetch('/admin/client-ip', { headers: { Authorization: 'Bearer ' + localStorage.getItem('disgourd.token') } }).then((r) => r.json()).then(console.log)
     ```
  3. Expect your public IP (the request still goes through Cloudflare), `via: "cf-connecting-ip"` and `trusted: true`.
- **From another container,** this should fail (no route, "bad address"):
  ```bash
  docker exec YOUR_OTHER_CONTAINER wget -qO- -T 5 http://disgourd:3000/auth-info
  ```
- **The site,** sign-in, an upload and a link preview all work as before.

**5. The LAN egress rule.**
- Copy `egress.sh` to the server and set `LAN`, `COMFY` and `TUNNEL` at the top.
- Add it as an Unraid User Script (for example `disgourd_egress`) set to "At Startup of Array". It waits up to two minutes for Docker's firewall chain, since Unraid can run it before Docker is up, and puts the tunnel back on `disgourd-edge`.
- Run it once now.
- It adds two things: a `DISGOURD-EGRESS` chain for traffic to other machines, and an `INPUT` rule for traffic to the Unraid host itself. DOCKER-USER never sees traffic to the host, so without that second rule the Unraid web UI stays reachable from the container. A `10.x` LAN is also covered by the `10.0.0.0/8` drop.
- Check from inside DisGourd:
  ```bash
  docker exec disgourd node -e "fetch('http://192.168.1.1').then(()=>console.log('open'),()=>console.log('blocked'))"
  docker exec disgourd node -e "fetch('http://192.168.1.10').then(()=>console.log('open'),()=>console.log('blocked'))"
  docker exec disgourd node -e "fetch('http://192.168.1.20:8188').then(()=>console.log('open'),()=>console.log('blocked'))"
  docker exec disgourd node -e "fetch('https://api.kie.ai').then(()=>console.log('open'),()=>console.log('blocked'))"
  ```
  - The router and the Unraid host (add its web UI port if it isn't 80) should print `blocked`.
  - ComfyUI (if running) and the internet should print `open`.
- Undo: run `./egress.sh remove` (it removes both the chain and the INPUT rule), and disable the User Script.

**6. Pin cloudflared** (optional, recommended).
- Use `cloudflare/cloudflared:2026.10.2@sha256:0e56c13c…93b2` (the full value is in `docker-compose.yml`) instead of `:latest`.
- To update later: check https://github.com/cloudflare/cloudflared/releases, `docker pull cloudflare/cloudflared:<new tag>`, then `docker inspect --format '{{index .RepoDigests 0}}' cloudflare/cloudflared:<new tag>` and paste it in.
- Undo: back to `:latest`.

## Backups
`/config` holds the database, its nightly backups (`/config/backups`), `.jwt-secret` and `.vapid.json`. Copy it off the box regularly.
