# P11-06 — Security headers, CSP and same-origin CORS

- **Unit Type:** Implementation (child of P11-00)
- **Phase:** 11
- **State:** READY
- **Effort:** S–M
- **Depends on:** none (soft: P11-05, which writes the proxy sample that the HSTS line goes in)
- **Serialize with:** P11-05 (proxy sample)
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
- **HSTS:** at the proxy (P11-05 sample; one line in the SWAG sample too), not in Node. Node doesn't know whether TLS is in front.

## Acceptance criteria
- [ ] AC-1: GET `/` carries the CSP and the other headers; `/auth-info` carries nosniff and no `Access-Control-Allow-Origin` for a foreign Origin.
- [ ] AC-2: in the sandbox (:3005, built client) a full walk shows no CSP violations in the console. The walk: log in, post with an image, a link preview, a custom emoji, a reaction, a DM, a voice join and a screen share, settings and avatar crop, /imagine panel opening.
- [ ] AC-3: framing the app from another origin is refused (a test checks the header; manually, an `<iframe>` from a file page is blank).
- [ ] AC-4: the dev server (`npm run dev` in web/) still works through its proxy.
- [ ] AC-5: both suites pass.

## Expected Areas of Change
`server/http/handler.js`, `server/static.js`, `deploy/swag/disgourd.subdomain.conf.sample` and `deploy/cloud/` (HSTS line), the README (ALLOWED_ORIGINS), tests (`server/tests/static.test.js`, a new `headers.test.js`).

## Not in scope
Moving the token out of `localStorage` into an HttpOnly cookie. That's a bigger change, with CSRF to handle; record it if the CSP walk shows the app can't run under a strict policy.
