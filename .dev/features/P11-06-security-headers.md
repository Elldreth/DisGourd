# P11-06 — Security headers, CSP and same-origin CORS

- **Unit Type:** Implementation (child of P11-00)
- **Phase:** 11
- **State:** REVIEW (build order 8 in P11-00)
- **Effort:** S–M
- **Depends on:** none
- **Serialize with:** P11-05 (both touch the deploy README)
- **Requirement Source:** P11-00 finding M1.

## Problem
- The app shell and API send no CSP, frame-ancestors, Referrer-Policy, Permissions-Policy or nosniff (`server/static.js:79`), and CORS is `*` (`server/http/handler.js:12-15`).
- The session token lives in `localStorage` for 7 days, so any future XSS is account takeover, with nothing to contain it. Any site can frame the app (clickjacking).

## Scope
- **Every response** from `handleHttp`: `X-Content-Type-Options: nosniff` and `Referrer-Policy: same-origin`.
- **The shell** (`index.html` and the SPA fallback): the CSP.
  - The policy: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'`.
  - Add `https:` to `img-src` only when `LINK_PREVIEW_IMAGES=direct`.
  - Also `Permissions-Policy: camera=(self), microphone=(self), display-capture=(self), geolocation=()`, and `X-Frame-Options: DENY` for old browsers.
- **Checking the CSP:** walk the app in the sandbox with it on and check the console for violations. Things to look at: the theme script (a file, so fine), highlight.js (styles only), emoji pickers, `blob:` previews for uploads and avatars, the glyph PNG canvas (`data:` / `blob:`), and voice and screen share. Fix any violation in code rather than loosening the policy where possible.
- **CORS:** drop `*`. Answer with `Access-Control-Allow-Origin` only for origins in `ALLOWED_ORIGINS` (default: none, because the app is same-origin). The Vite dev proxy (`web/devProxy.js`) is same-origin to the browser already; confirm it.
- **HSTS:** the live setup has no proxy of its own (cloudflared talks to the app directly), so HSTS comes from Cloudflare: SSL/TLS → Edge Certificates → HSTS (P11-00 "Cloudflare settings to do now"). Node doesn't set it, because it doesn't know whether TLS is in front. The SWAG sample keeps an HSTS line for LAN/SWAG installs.

## Acceptance criteria
- [x] AC-1: GET `/` carries the CSP and the other headers; `/auth-info` carries nosniff and no `Access-Control-Allow-Origin` for a foreign Origin.
- [x] AC-2: in the sandbox (:3005, built client) a full walk shows no CSP violations in the console. The walk: log in, post with an image, a link preview, a custom emoji, a reaction, a DM, a voice join and a screen share, settings and avatar crop, /imagine panel opening.
- [x] AC-3: framing the app from another origin is refused (a test checks the header; manually, an `<iframe>` from a file page is blank).
- [x] AC-4: the dev server (`npm run dev` in web/) still works through its proxy.
- [x] AC-5: both suites pass.

## As built
- **`server/http/handler.js`, on every answer:**
  - `X-Content-Type-Options: nosniff` and `Referrer-Policy: same-origin`.
  - CORS: `Access-Control-Allow-Origin: *` is gone. A request whose `Origin` is in `ALLOWED_ORIGINS` (comma-separated, read per request) gets that origin back, plus `Vary: Origin` and the allowed methods and headers. Anyone else gets no CORS headers.
  - `OPTIONS` still answers 204.
- **`server/static.js`, on every HTML page** (the shell, the SPA fallback, `offline.html`), via `pageHeaders(req)`:
  - `Content-Security-Policy`: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:` (+ `https:` with `LINK_PREVIEW_IMAGES=direct`) `; media-src 'self' blob:; font-src 'self' data:; connect-src 'self' <ws(s)://this host>; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'`.
  - The socket's `ws://` or `wss://` origin comes from `originFor(req)`, which honours `X-Forwarded-Proto` / `-Host` only from a trusted proxy (P11-05).
  - `X-Frame-Options: DENY` (for old browsers) and `Permissions-Policy: camera=(self), microphone=(self), display-capture=(self), geolocation=(), payment=(), usb=()`.
- **What the policy allows, and why:**
  - **Scripts:** only files. The built `index.html` has `/theme-init.js` and the Vite bundle, and no inline script.
  - **Styles:** `'unsafe-inline'` covers React style attributes (avatars, role colours, the cropper) and the glyph tiles' inline SVG.
  - **Images:** `/uploads` and `/media/preview` on our origin; `data:` for the glyph tiles turned into PNGs; `blob:` for the image cropper.
  - **Fonts:** bundled under `/assets`.
  - **The service worker:** `/sw.js`.
  - **The live socket:** `/gateway`.
  - WebRTC voice and video use `srcObject`, which `media-src` doesn't govern; `blob:` media is allowed anyway.
- **Docs:** `ALLOWED_ORIGINS` in the README table. The SWAG sample adds an HSTS `add_header`, with a note to skip it if `ssl.conf` already sets it.

## Which header comes from where (the live setup)
| Header | Sent by | Notes |
|---|---|---|
| `Strict-Transport-Security` | **Cloudflare** (1 month, includeSubDomains, no preload) | Not by Node: it can't tell whether TLS is in front. SWAG and Caddy installs set it in the proxy (samples in `deploy/`) |
| `X-Content-Type-Options: nosniff` | **Node** on every answer, **and Cloudflare** (its HSTS "nosniff" option) | If both arrive, the values are the same; browsers treat `nosniff, nosniff` as `nosniff`. Node keeps sending it for installs without Cloudflare |
| `Content-Security-Policy`, `X-Frame-Options`, `Permissions-Policy` | **Node**, on HTML pages | Uploads and preview images carry their own `default-src 'none'; sandbox` policy (P11-04, P2-23) |
| `Referrer-Policy: same-origin` | **Node**, on every answer | |
| `Access-Control-Allow-Origin` | **Node**, only for `ALLOWED_ORIGINS` | None by default |

## Verification Evidence
| Acceptance Criterion | Status | Verification Type | Evidence |
|---|---|---|---|
| AC-1 | Verified | Jest `headers.test.js` | The shell's CSP is checked directive by directive (`connect-src` names `ws://<host>`, and `wss://` behind a trusted TLS proxy; `https:` images only with `direct`), plus `X-Frame-Options`, `Referrer-Policy`, nosniff, `Permissions-Policy`, and no HSTS. `/auth-info` and a static file get nosniff and no page policy. A foreign `Origin` gets no ACAO (GET and preflight); `ALLOWED_ORIGINS` echoes listed origins with `Vary: Origin` |
| AC-2 | Verified | Sandbox :3005 with the built client | **Enforced:** an injected inline `<script>` didn't run (`script-src-elem inline` violation), and an image from https://example.com was refused (`img-src`). **No violations** (console and a `securitypolicyviolation` listener) through: load and sign-in (service worker active), the live socket, sending a message, the emoji picker, a reaction (then removed), the image viewer on an /imagine image, Server settings → a ready-made icon (`data:` SVG → canvas → upload → shown) then removed, the moderation log, and joining a voice channel (listen-only; the pane blocks microphones). **Second walk (no violations, no CSP change needed):** the /imagine panel and a generation with the test engine, with its result image; a DM and a group DM, each with an image attachment (rendered); avatar upload → cropper (`blob:` preview) → saved avatar shown, then removed; screen share from a canvas `captureStream()` (the video tile plays it); a link-preview card in the default proxy mode (the image loads from `/media/preview/…`); and a rebuild → the "new version" toast → **Reload** (new bundle loaded, the new service worker in control). Push: the pane blocks notifications, so the app shows its "blocked" message; the VAPID key request returns 200. **Not run:** Variation and Upscale, because this PC's ComfyUI is the owner's real one; they use the same image sources as the result image |
| AC-3 | Verified | Jest | `frame-ancestors 'none'` plus `X-Frame-Options: DENY` on every HTML page |
| AC-4 | Verified (by design) | `web/devProxy.js` tests | The Vite dev server serves its own `index.html` (no Node CSP), and its proxy makes API calls same-origin to the browser, so dropping `*` doesn't affect it. `ALLOWED_ORIGINS=http://localhost:5173` exists if a separate client ever needs it |
| AC-5 | Verified | Jest, Vitest | Server 62 suites / 552 tests; web 107 files / 844 tests; `vite build` clean |

## Discovered Work (not done here)
- **HttpOnly cookie sessions** instead of a `localStorage` token remain out of scope. The CSP now contains the XSS → token theft path this was about.
- **Some sites give no link-preview card** (github.com, nodejs.org, python.org from this PC), while example.com, MDN, Wikipedia and rust-lang.org do. That's the server-side unfurl, not the CSP; worth a look if a commonly shared site never gets a card on the live server.

## Expected Areas of Change
`server/http/handler.js`, `server/static.js`, `deploy/swag/disgourd.subdomain.conf.sample` (HSTS line), `deploy/unraid-tunnel/README.md` (the Cloudflare HSTS setting), the README (ALLOWED_ORIGINS), tests (`server/tests/static.test.js`, a new `headers.test.js`).

## Not in scope
Moving the token out of `localStorage` into an HttpOnly cookie. That's a bigger change, with CSRF to handle; record it if the CSP walk shows the app can't run under a strict policy.
