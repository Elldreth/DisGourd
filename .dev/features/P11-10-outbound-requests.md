# P11-10 — Push endpoint allowlist (go-live blocker); ComfyUI metadata block

- **Unit Type:** Implementation (child of P11-00)
- **Phase:** 11
- **State:** REVIEW (build order 1, the go-live blocker; the owner said go on 2026-10-21)
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
- [x] AC-1: a push subscription to `https://192.168.1.1/x`, `https://10.0.0.5/x`, `https://audiobookshelf/x`, `https://example.com/x` or `https://fcm.googleapis.com.evil.example/x` → 400. A real FCM, Mozilla, WNS or Apple endpoint shape → 201.
- [x] AC-2: a saved subscription whose allowed host resolves to `192.168.1.1` (an injected lookup) isn't sent to, and a warning is logged.
- [x] AC-3: at start, saved rows with other hosts are deleted (a test seeds one of each).
- [x] AC-4: an 11th subscription drops the oldest.
- [x] AC-5 (partly, see evidence): notifications still arrive for real subscriptions. The existing push tests pass, and on the sandbox a Chrome subscription still saves.
- [x] AC-6: saving or testing ComfyUI at `http://169.254.169.254/` (or a hostname resolving there, with an injected lookup) → 400. A ComfyUI that redirects to a link-local address fails cleanly. `http://192.168.1.20:8188` is still accepted (fake lookup, no network).
- [x] AC-7: the imagine suites pass.

## As built
- **`server/net/pushHosts.js`** (new):
  - `allowedPushEndpoint` accepts https, port 443 (or none), with no credentials and no IP literal, to `fcm.googleapis.com`, `updates.push.services.mozilla.com`, `*.push.services.mozilla.com`, `*.notify.windows.com` or `web.push.apple.com`. `PUSH_HOSTS_EXTRA` adds more (`host` exact, `*.host` subdomains only).
  - `endpointAddressesOk` resolves the host and refuses any private, loopback, link-local or CGNAT answer (`isBlockedAddress`). It caches the answer for 10 minutes. A DNS failure means no push (fail closed), isn't cached, and logs once per host.
  - `pruneSubscriptions` deletes saved rows for other hosts.
  - `setLookup` swaps in a fake DNS for tests.
- **`POST /push/subscriptions`** answers 400 "That push service isn't supported" for anything else.
- **`server/push.js`:**
  - At start it prunes old rows and logs `[push] Removed N push subscription(s)…`.
  - Before each send it drops a row that isn't allowed and skips one whose addresses aren't public.
- **`db.savePushSubscription`** keeps the newest 10 per person.
- **ComfyUI** (`server/imagine/engines/comfyui.js`):
  - Requests go through `guardedFetch`. It refuses link-local, `0.0.0.0/8`, AWS's IPv6 metadata address and the metadata host names, by literal or by DNS answer. It follows redirects by hand (GET only, at most 3), checking each.
  - Saving such an address is refused with "That address isn’t allowed for ComfyUI".
  - LAN, loopback and tailnet addresses still work.
  - `server/net/safeFetch.js` exports `isLinkLocalOrMetadata` and `METADATA_HOSTS`.
- **README:** `PUSH_HOSTS_EXTRA` in the configuration table, and two security notes (what the server fetches, and keeping ComfyUI off the internet).
- **Tests:** the older push, blocking and group-DM tests now use real FCM endpoint shapes and a fake public DNS answer (no network).

## Verification Evidence
| Acceptance Criterion | Status | Verification Type | Evidence |
|---|---|---|---|
| AC-1 | Verified | Jest `push-allowlist.test.js` + sandbox | 12 refused shapes (LAN IPs, `audiobookshelf`, look-alike hosts, http, :8443, credentials, an IPv6 literal) → 400; 6 real service shapes → 201. Sandbox :3005 as sandy: `192.168.1.1`, `audiobookshelf`, `10.0.0.5` and `fcm.googleapis.com.evil.example` → 400; an FCM endpoint → 201 |
| AC-2 | Verified | Jest | An allowed host resolving to 192.168.1.1 isn't sent to (the other device still is), and a warning names the host. A DNS failure sends nothing |
| AC-3 | Verified | Jest + sandbox | Seeded rows: the LAN one goes, the FCM one stays. On the sandbox DB, a seeded `https://192.168.1.1/old` row was gone after the restart; a copy of the sandbox DB printed `[push] Removed 1 push subscription(s) that weren't for a known push service` |
| AC-4 | Verified | Jest | 11 subscriptions → 10 kept, `dev1` dropped |
| AC-5 | Partly | Jest (the existing push, blocking and group-DM suites) + sandbox API | All pass with FCM-shaped endpoints. A real browser subscription wasn't made: the app's browser pane can't subscribe to a push service. After deploying, the owner should turn notifications on once (Chrome makes an `fcm.googleapis.com` endpoint, which is allowed) and check that a mention arrives |
| AC-6 | Verified | Jest `comfy-address-guard.test.js` + sandbox | 8 refused addresses at save; 5 allowed (LAN, tailnet, loopback, a `.lan` name). A name resolving to 169.254.169.254 or fe80::1 is refused before any request; a redirect to the metadata address is refused; `/admin/imagine/comfyui/test` → 400. Sandbox: the same endpoint → 400 "That address isn’t allowed for ComfyUI" |
| AC-7 | Verified | Jest | `imagine-comfyui.test.js` and the other imagine suites pass |
| Suites | Verified | Jest, Vitest | Server 55 suites / 500 tests; web 106 files / 838 tests |

## Discovered Work (not done here)
- **DNS rebinding:** the ComfyUI check resolves DNS, and then `fetch` resolves again, so a host that changes its answer between the two could slip through. That's accepted here: the address is set by an admin, and only link-local or metadata targets are refused. Pinning the address like `safeFetch` does would need a custom agent for `fetch`.
- **Tailscale ACL sample:** the scope's VPS-only item (a sample Tailscale ACL) wasn't written, since the live setup is the Unraid box with ComfyUI on the LAN. Add it if a VPS setup comes back.
- **The sandbox on :3005** was a leftover from 2026-10-20 running main's older code. It was stopped and restarted from this branch.

## Expected Areas of Change
`server/routes/push.js`, `server/push.js`, `server/db/index.js` (subscription cap and clean-up), `server/net/safeFetch.js` (one export), `server/imagine/engines/comfyui.js`, the README, tests (`push.test.js`, `imagine-comfyui.test.js`).

## Not in scope
Auth headers for ComfyUI. Other server-side requests: link previews, preview images and kie.ai downloads already go through `safeFetch`, which blocks the LAN, loopback, CGNAT/Tailscale and ULA ranges after DNS and on every redirect.
