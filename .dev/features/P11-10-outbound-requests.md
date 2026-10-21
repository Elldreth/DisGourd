# P11-10 — Outbound requests: ComfyUI metadata block and tunnel docs; push endpoint vetting

- **Unit Type:** Implementation (child of P11-00)
- **Phase:** 11
- **State:** READY
- **Effort:** S
- **Depends on:** none
- **Serialize with:** none
- **Requirement Source:** P11-00 findings M5 and M10, and its "Hosting setups" section. Push vetting is a go-live item in both setups: from the Unraid box or a tailnet VPS it's the one server-side request that can reach the home LAN.

## Problem
- The ComfyUI URL a site admin saves is fetched with no address checks (`server/imagine/engines/comfyui.js:428-437`), and `fetch` follows redirects. A stolen admin login can read the cloud metadata service (`169.254.169.254`) through the test and list replies. And exposing the home ComfyUI to the internet so the cloud server can reach it would expose a service that runs arbitrary code.
- Push subscriptions accept any `https://` endpoint (`server/routes/push.js:8-10`). The server then POSTs to it (`server/push.js:69`), into its own network (the home LAN on Unraid, the tailnet from a VPS) or at third parties. It's the only outbound request that doesn't go through `safeFetch`.

## Scope
- **ComfyUI:**
  - Before each request (and on each redirect, using `redirect: 'manual'`, at most 3 hops), resolve the host and refuse link-local addresses (169.254.0.0/16, fe80::/10), `0.0.0.0/8`, and the metadata names (`metadata.google.internal`, `metadata`, `instance-data`).
  - Loopback, LAN, CGNAT and tailnet ranges (100.64.0.0/10) stay allowed: that's where ComfyUI lives.
  - Reuse `isBlockedAddress` pieces from `server/net/safeFetch.js` (export a `isLinkLocalOrMetadata`).
  - Saving a refused URL says "That address isn't allowed for ComfyUI".
- **Docs:** README section "ComfyUI from a cloud server". Run Tailscale (or WireGuard) on both machines and use the ComfyUI box's tailnet address. Never port-forward ComfyUI.
  - **A Tailscale ACL** (a sample policy): the VPS gets a tag (`tag:disgourd`) that may reach only `home-pc:8188`. Nothing at home may reach the VPS except SSH from the owner's devices. The VPS doesn't accept subnet routes (`--accept-routes=false`) and isn't an exit node. Key expiry stays on for the owner's devices; a tagged node's key doesn't expire, so note how to revoke it.
  - **On Unraid,** P11-05's LAN egress rule plays the same part. Optionally put it behind a reverse proxy with basic auth (the URL field refuses `user:pass@`, so that would need a header option; recorded, not planned).
- **Push:**
  - Accept only endpoints whose host is a known push service, or ends with one: `fcm.googleapis.com`, `updates.push.services.mozilla.com`, `*.push.services.mozilla.com`, `*.notify.windows.com`, `web.push.apple.com`.
  - The list goes in `PUSH_HOSTS` and can be extended through the environment.
  - At most 10 subscriptions per user (the oldest dropped).
  - Also when sending: resolve the endpoint's host and skip it if any address is blocked by `isBlockedAddress` (covers a poisoned DNS answer or a list entry added by mistake). Log it once.

## Acceptance criteria
- [ ] AC-1: saving or testing `http://169.254.169.254/` (and a hostname resolving there, using an injected lookup in the test) → 400.
- [ ] AC-2: a ComfyUI that redirects to a link-local address fails cleanly.
- [ ] AC-3: `http://192.168.1.20:8188` and `http://100.101.102.103:8188` are accepted (the tests use a fake lookup; no network).
- [ ] AC-4: a push subscription to `https://10.0.0.5/x` or `https://example.com/x` → 400; an FCM or Mozilla endpoint → 201.
- [ ] AC-5: the existing imagine and push suites pass.
- [ ] AC-6: a saved subscription whose host resolves to `192.168.1.1` or `100.100.1.1` (an injected lookup) isn't sent to.
- [ ] AC-7: the README has the Tailscale ACL sample, and `tailscale`'s policy checker accepts it (or it's checked by hand against the docs if no tailnet is at hand).

## Expected Areas of Change
`server/imagine/engines/comfyui.js`, `server/net/safeFetch.js` (one export), `server/routes/push.js`, `server/db/index.js` (subscription cap), the README, tests (`imagine-comfyui.test.js`, `push.test.js`).

## Not in scope
Auth headers for ComfyUI.
