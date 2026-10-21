#!/bin/bash
# DisGourd LAN egress rule (P11-05). Run on the Unraid host as root: an Unraid
# User Script (e.g. "disgourd_egress") set to "At Startup of Array", and again
# by hand after a Docker restart. Safe to run twice.
#
# Traffic from the disgourd-edge network may go to the internet and to
# ComfyUI, but not to the rest of the LAN, other Docker networks, Tailscale,
# link-local addresses, or the Unraid host itself. So even a compromised
# DisGourd container can't reach the router, the Unraid web UI or SMB. DNS
# keeps working: containers ask Docker's built-in resolver, which isn't
# filtered here.
#
#   ./egress.sh          add (or refresh) the rule, and put the tunnel on disgourd-edge
#   ./egress.sh remove   take the rule out again
set -euo pipefail

EDGE=172.30.80.0/24              # the disgourd-edge subnet (docker-compose.yml)
LAN=192.168.1.0/24               # your home LAN: check with `ip route` (a 10.x LAN is also covered by 10/8 below)
COMFY=192.168.1.20               # the ComfyUI machine (blank to block ComfyUI too)
COMFY_PORT=8188
TUNNEL=cloudflared               # the tunnel container's name (an Unraid template may call it e.g. Unraid-Cloudflared-Tunnel)
CHAIN=DISGOURD-EGRESS

remove() {
  iptables -D DOCKER-USER -s "$EDGE" -j "$CHAIN" 2>/dev/null || true
  iptables -F "$CHAIN" 2>/dev/null || true
  iptables -X "$CHAIN" 2>/dev/null || true
  # The rule that keeps DisGourd off the Unraid host itself.
  iptables -D INPUT -s "$EDGE" -m conntrack --ctstate NEW -j DROP 2>/dev/null || true
}

if [ "${1:-}" = remove ]; then
  remove
  echo "DisGourd egress rule removed."
  exit 0
fi

# At array start, Unraid can run this before Docker has made its DOCKER-USER
# chain. Wait up to two minutes for it.
for _ in $(seq 1 60); do
  iptables -L DOCKER-USER -n >/dev/null 2>&1 && break
  sleep 2
done
if ! iptables -L DOCKER-USER -n >/dev/null 2>&1; then
  echo "Docker's DOCKER-USER chain isn't there (is Docker running?). Nothing changed." >&2
  exit 1
fi

# An Unraid template container loses extra networks when it's re-created (a
# template edit or update), so put the tunnel back on disgourd-edge each time.
docker network connect disgourd-edge "$TUNNEL" 2>/dev/null || true

# Containers -> elsewhere (forwarded traffic): through our chain.
iptables -N "$CHAIN" 2>/dev/null || iptables -F "$CHAIN"
iptables -A "$CHAIN" -m conntrack --ctstate RELATED,ESTABLISHED -j RETURN
iptables -A "$CHAIN" -d "$EDGE" -j RETURN                      # DisGourd <-> the tunnel
if [ -n "$COMFY" ]; then
  iptables -A "$CHAIN" -d "$COMFY" -p tcp --dport "$COMFY_PORT" -j RETURN
fi
for net in "$LAN" 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 100.64.0.0/10 169.254.0.0/16; do
  iptables -A "$CHAIN" -d "$net" -j DROP
done
iptables -C DOCKER-USER -s "$EDGE" -j "$CHAIN" 2>/dev/null || iptables -I DOCKER-USER -s "$EDGE" -j "$CHAIN"

# Containers -> the Unraid host itself goes through INPUT, not DOCKER-USER, so
# new connections from disgourd-edge to the host are dropped there. (Replies
# to the host and DNS through Docker's resolver are unaffected.)
iptables -C INPUT -s "$EDGE" -m conntrack --ctstate NEW -j DROP 2>/dev/null || iptables -I INPUT -s "$EDGE" -m conntrack --ctstate NEW -j DROP

echo "DisGourd egress rule in place:"
iptables -L "$CHAIN" -n --line-numbers
iptables -L INPUT -n --line-numbers | grep -F "$EDGE" || true
