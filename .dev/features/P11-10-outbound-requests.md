# P11-10 — Outbound requests: ComfyUI metadata block and tunnel docs; push endpoint vetting

- **Unit Type:** Implementation (child of P11-00)
- **Phase:** 11
- **State:** READY
- **Effort:** S
- **Depends on:** none
- **Serialize with:** none
- **Requirement Source:** P11-00 findings M5 and M10.

## Problem
- The ComfyUI URL a site admin saves is fetched with no address checks (`server/imagine/engines/comfyui.js:428-437`), and `fetch` follows redirects. A stolen admin login can read the cloud metadata service (`169.254.169.254`) through the test and list replies. And exposing the home ComfyUI to the internet so the cloud server can reach it would expose a service that runs arbitrary code.
- Push subscriptions accept any `https://` endpoint (`server/routes/push.js:8-10`). The server then POSTs to it (`server/push.js:69`), into its own network or at third parties.

## Scope
- **ComfyUI:**
  - Before each request (and on each redirect, using `redirect: 'manual'`, at most 3 hops), resolve the host and refuse link-local addresses (169.254.0.0/16, fe80::/10), `0.0.0.0/8`, and the metadata names (`metadata.google.internal`, `metadata`, `instance-data`).
  - Loopback, LAN, CGNAT and tailnet ranges (100.64.0.0/10) stay allowed: that's where ComfyUI lives.
  - Reuse `isBlockedAddress` pieces from `server/net/safeFetch.js` (export a `isLinkLocalOrMetadata`).
  - Saving a refused URL says "That address isn't allowed for ComfyUI".
- **Docs:** README section "ComfyUI from a cloud server". Run Tailscale (or WireGuard) on both machines and use the ComfyUI box's tailnet address. Never port-forward ComfyUI. Optionally put it behind a reverse proxy with basic auth (the URL field refuses `user:pass@`, so that would need a header option; recorded, not planned).
- **Push:**
  - Accept only endpoints whose host is a known push service, or ends with one: `fcm.googleapis.com`, `updates.push.services.mozilla.com`, `*.push.services.mozilla.com`, `*.notify.windows.com`, `web.push.apple.com`.
  - The list goes in `PUSH_HOSTS` and can be extended through the environment.
  - At most 10 subscriptions per user (the oldest dropped).

## Acceptance criteria
- [ ] AC-1: saving or testing `http://169.254.169.254/` (and a hostname resolving there, using an injected lookup in the test) → 400.
- [ ] AC-2: a ComfyUI that redirects to a link-local address fails cleanly.
- [ ] AC-3: `http://192.168.1.20:8188` and `http://100.101.102.103:8188` are accepted (the tests use a fake lookup; no network).
- [ ] AC-4: a push subscription to `https://10.0.0.5/x` or `https://example.com/x` → 400; an FCM or Mozilla endpoint → 201.
- [ ] AC-5: the existing imagine and push suites pass.

## Expected Areas of Change
`server/imagine/engines/comfyui.js`, `server/net/safeFetch.js` (one export), `server/routes/push.js`, `server/db/index.js` (subscription cap), the README, tests (`imagine-comfyui.test.js`, `push.test.js`).

## Not in scope
Auth headers for ComfyUI.
