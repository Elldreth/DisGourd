#!/bin/bash
# DisGourd LAN egress rule (P11-05). Run on the Unraid host as root, after
# Docker has started (an Unraid User Script set to "At Startup of Array", and
# again by hand after a Docker restart). Safe to run twice.
#
# Traffic from the disgourd-edge network may go to the internet and to
# ComfyUI, but not to the rest of the LAN, other Docker networks, Tailscale or
# link-local addresses. So even a compromised DisGourd container can't reach
# the router, the Unraid web UI or SMB. DNS keeps working: containers ask
# Docker's built-in resolver, which isn't filtered here.
#
#   ./egress.sh          add (or refresh) the rule
#   ./egress.sh remove   take it out again
set -euo pipefail

EDGE=172.30.80.0/24        # the disgourd-edge subnet (docker-compose.yml)
LAN=192.168.1.0/24         # your home LAN: check with `ip route` on the Unraid box
COMFY=192.168.1.20         # the ComfyUI machine (blank to block ComfyUI too)
COMFY_PORT=8188
CHAIN=DISGOURD-EGRESS

remove() {
  iptables -D DOCKER-USER -s "$EDGE" -j "$CHAIN" 2>/dev/null || true
  iptables -F "$CHAIN" 2>/dev/null || true
  iptables -X "$CHAIN" 2>/dev/null || true
}

if [ "${1:-}" = remove ]; then
  remove
  echo "DisGourd egress rule removed."
  exit 0
fi

iptables -N "$CHAIN" 2>/dev/null || iptables -F "$CHAIN"
iptables -A "$CHAIN" -m conntrack --ctstate RELATED,ESTABLISHED -j RETURN
iptables -A "$CHAIN" -d "$EDGE" -j RETURN                      # DisGourd <-> cloudflared
if [ -n "$COMFY" ]; then
  iptables -A "$CHAIN" -d "$COMFY" -p tcp --dport "$COMFY_PORT" -j RETURN
fi
for net in "$LAN" 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 100.64.0.0/10 169.254.0.0/16; do
  iptables -A "$CHAIN" -d "$net" -j DROP
done
iptables -C DOCKER-USER -s "$EDGE" -j "$CHAIN" 2>/dev/null || iptables -I DOCKER-USER -s "$EDGE" -j "$CHAIN"
echo "DisGourd egress rule in place:"
iptables -L "$CHAIN" -n --line-numbers
