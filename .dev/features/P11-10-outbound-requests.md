# P11-10 — Push endpoint allowlist (go-live blocker); ComfyUI metadata block

- **Unit Type:** Implementation (child of P11-00)
- **Phase:** 11
- **State:** READY. **Build order 1: the go-live blocker.** Start only when the owner says so.
- **Effort:** S
- **Depends on:** none
- **Serialize with:** none
- **Requirement Source:** P11-00 findings M10 (High on the home LAN) and M5, plus "Deployment as built (2026-10-21)". DisGourd runs on the Unraid box, so the server sits on the owner's LAN.

## Problem
- **Push (the blocker):** push subscriptions accept any `https://` endpoint (`server/routes/push.js:8-10`), and the server POSTs to it whenever that user is mentioned or DMed while away (`server/push.js:69`). It's the only server-side request that doesn't go through `safeFetch`.
  - Any member can register `https://192.168.1.1/…` (the router), the Unraid web UI, another container (`https://audiobookshelf/…`) or any https service on the LAN, then get themself mentioned. The server sends POSTs there from inside the home network.
  - It's blind (the body is encrypted), but it reaches devices that were never meant to face the internet, and it can be used to make the server hammer a third party.
- **ComfyUI (smaller):** the URL a site admin saves is fetched with no address checks (`server/imagine/engines/comfyui.js:428-437`), and `fetch` follows redirects. A stolen admin login can point it anywhere and read the answer back through the test and list replies. ComfyUI legitimately lives on the LAN, so LAN addresses must stay allowed; only link-local and metadata addresses are refused (they matter if this ever moves to a VPS).

## Scope
**Push (do this first; it can ship on its own if the ComfyUI part waits):**
- **Allowlist:** accept a subscription only if its endpoint's host is, or ends with, a known push service: `fcm.googleapis.com` (Chrome, Android, Edge on Android), `updates.push.services.mozilla.com` and `*.push.services.mozilla.com` (Firefox), `*.notify.windows.com` (Edge on Windows), `web.push.apple.com` (Safari, iOS).
  - `https:` only, port 443 or none, and no `user:pass@`.
  - The list is a constant; `PUSH_HOSTS_EXTRA` (comma-separated) adds to it.
  - A refused subscription answers 400 "That push service isn't supported".
- **When sending, too:** resolve the endpoint's host and skip it if any address is blocked by `isBlockedAddress` (`server/net/safeFetch.js`). That covers a poisoned DNS answer or a bad `PUSH_HOSTS_EXTRA` entry. Log it once per endpoint.
- **Existing rows:** at start, delete saved subscriptions whose host isn't on the list (they couldn't be legitimate pushes anyway), and log how many.
- **Cap:** at most 10 subscriptions per user; a new one past that drops the oldest.

**ComfyUI:**
- Before each request, and on each redirect (`redirect: 'manual'`, at most 3 hops), resolve the host and refuse link-local addresses (169.254.0.0/16, fe80::/10), `0.0.0.0/8`, and the metadata names (`metadata.google.internal`, `metadata`, `instance-data`).
- Loopback, LAN, CGNAT and tailnet ranges stay allowed: that's where ComfyUI lives.
- Reuse the address pieces from `server/net/safeFetch.js` (export an `isLinkLocalOrMetadata`).
- Saving a refused URL says "That address isn't allowed for ComfyUI".
- **Docs:** README "ComfyUI": keep ComfyUI LAN-only and never port-forward or tunnel it publicly (it runs arbitrary workflows). On Unraid, P11-05's egress rule lets DisGourd reach only ComfyUI:8188.
  - For a VPS setup (not the live one), reach ComfyUI over Tailscale with a sample ACL: the VPS tag may reach only `home-pc:8188`, doesn't accept routes, and isn't an exit node.

## Acceptance criteria
- [ ] AC-1: a push subscription to `https://192.168.1.1/x`, `https://10.0.0.5/x`, `https://audiobookshelf/x`, `https://example.com/x` or `https://fcm.googleapis.com.evil.example/x` → 400. A real FCM, Mozilla, WNS or Apple endpoint shape → 201.
- [ ] AC-2: a saved subscription whose allowed host resolves to `192.168.1.1` (an injected lookup) isn't sent to, and a warning is logged.
- [ ] AC-3: at start, saved rows with other hosts are deleted (a test seeds one of each).
- [ ] AC-4: an 11th subscription drops the oldest.
- [ ] AC-5: notifications still arrive for real subscriptions. The existing push tests pass, and on the sandbox a Chrome subscription still saves.
- [ ] AC-6: saving or testing ComfyUI at `http://169.254.169.254/` (or a hostname resolving there, with an injected lookup) → 400. A ComfyUI that redirects to a link-local address fails cleanly. `http://192.168.1.20:8188` is still accepted (fake lookup, no network).
- [ ] AC-7: the imagine suites pass.

## Expected Areas of Change
`server/routes/push.js`, `server/push.js`, `server/db/index.js` (subscription cap and clean-up), `server/net/safeFetch.js` (one export), `server/imagine/engines/comfyui.js`, the README, tests (`push.test.js`, `imagine-comfyui.test.js`).

## Not in scope
Auth headers for ComfyUI. Other server-side requests: link previews, preview images and kie.ai downloads already go through `safeFetch`, which blocks the LAN, loopback, CGNAT/Tailscale and ULA ranges after DNS and on every redirect.
