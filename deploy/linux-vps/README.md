# Recipe: DisGourd on a Linux VPS

An optional setup for a small cloud server (any distro with Docker). There are two ways in; pick one.

## Change these
| Placeholder | What to put there |
|---|---|
| `disgourd.your-domain.example` | your hostname (a DNS A/AAAA record to the VPS, or a Cloudflare Tunnel hostname) |
| `/srv/disgourd` | where you clone the repo on the VPS |
| `TUNNEL_TOKEN` | only for option B: the tunnel's token, in `.env` (chmod 600) |

## Start
```bash
git clone https://github.com/Elldreth/DisGourd.git /srv/disgourd
cd /srv/disgourd && docker compose up -d --build
docker logs disgourd     # shows the one-time setup code for the first account
```
The root `docker-compose.yml` already runs DisGourd read-only, with no capabilities and no published port. Data goes in `/srv/disgourd/data`.

## Option A: Caddy (automatic HTTPS)
1. Open only ports 22, 80 and 443 in the VPS firewall (or the provider's), and use SSH keys.
2. Add Caddy to the same compose project, publishing 80 and 443, with this `Caddyfile`:
   ```
   disgourd.your-domain.example {
     reverse_proxy disgourd:3000
     header Strict-Transport-Security "max-age=31536000; includeSubDomains"
     request_body {
       max_size 25MB
     }
   }
   ```
   WebSockets (`/gateway`) pass through `reverse_proxy` with no extra settings.
3. Tell DisGourd to trust only Caddy: put both on one network with a fixed subnet, and set `TRUSTED_PROXIES` to it (for example `172.30.80.0/24`). Caddy sets `X-Forwarded-For` to the visitor, so `CLIENT_IP_HEADER` isn't needed.

**Docker skips ufw and firewalld for published ports.** Publish only Caddy's 80 and 443, never DisGourd's 3000.

## Option B: Cloudflare Tunnel (no open ports)
Follow `deploy/unraid-tunnel/` for the compose file, the `disgourd-edge` network, `TRUSTED_PROXIES=172.30.80.0/24` and `CLIENT_IP_HEADER=cf-connecting-ip`, and the Cloudflare dashboard settings. On a VPS:
- Skip the Unraid User Script. Run `egress.sh` from a systemd unit after `docker.service`, with `LAN` set to the provider's private network.
- Leave SSH as the only open port.
- Reach a home ComfyUI over Tailscale, with an ACL that lets the VPS reach only that machine's port 8188 (P11-10).

## Either way
- Keep the domain, tokens and IPs in the repo's `local/` folder (git ignores it).
- Copy `/srv/disgourd/data/config` off the server regularly (the database, its backups, `.jwt-secret`, `.vapid.json`).
