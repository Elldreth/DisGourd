# P2-18a — Service worker + installable shell

- **Unit Type:** Implementation (child of P2-18)
- **Phase:** 2
- **State:** COMPLETE (merged in #113, 2026-10-18)
- **Effort:** S–M
- **Depends on:** P1-04 (`static.js` serves the built client)
- **Serialize with:** `server/static.js`, `web/vite.config.js`, `web/src/App.jsx`

## Scope
- **A hand-written service worker** (`web/sw.js`, emitted to `dist/sw.js` at build with a build id stamped in, so every deploy is a new worker):
  - **Navigations:** network first; when the network fails, the cached `/offline.html`.
  - **`/assets/*`:** cache first (Vite fingerprints them), stored on first fetch.
  - **The shell files** (`/manifest.json`, icons, `/theme-init.js`, `/offline.html`): precached at install, refreshed network-first.
  - **Everything else is left alone:** `/spaces`, `/dms`, `/uploads`, `/media`, `/gateway`, auth, search, admin: the worker never answers those, so nothing private is ever cached.
  - Old caches are deleted when a new worker activates.
- **Offline page** `web/public/offline.html`: self-contained (inline styles, inline gourd), "You're offline" with a Retry button.
- **Serving:** `/sw.js`, `/index.html` (the app shell) and `/manifest.json` are served with `Cache-Control: no-cache`, so a new deploy is noticed on the next load; `/assets/*` stay immutable.
- **Registration and updates** (`web/src/pwa.js`): the app registers the worker in production builds only. When a new worker is installed behind a running one, a toast says "A new version of DisGourd is ready" with **Reload**; Reload tells the waiting worker to take over and reloads once it has.
- Installable: the manifest and icons already exist; with the worker, Chrome's install criteria are met.

## Acceptance criteria
- [x] Server test: `/sw.js`, `/` and `/manifest.json` come with `Cache-Control: no-cache`; `/assets/x.js` stays `immutable`.
- [x] Web tests (`pwa.test.js`): registers `/sw.js`; an update installed behind a controller calls `onUpdate`; applying it posts `SKIP_WAITING` to the waiting worker; a controller change reloads once; does nothing without service worker support.
- [x] `sw.test.js`: the worker's routing decides correctly for a navigation, an asset, a shell file and an API call (the API call is left alone), and the build id is stamped into `dist/sw.js`.
- [x] Sandbox (production build on :3005): the worker controls the page after a reload; `/offline.html` and the icons are in the cache; the API responses are not; a rebuild followed by a reload shows the update toast and Reload swaps to the new worker.
- [x] Both suites pass; `vite build` emits `dist/sw.js` with the build id.

## Expected Areas of Change
`web/sw.js` (new), `web/public/offline.html` (new), `web/vite.config.js`, `web/src/pwa.js` (new), `web/src/App.jsx`, `server/static.js`, tests.

## Working Set / Blast Radius
~7 files. The risk with service workers is caching something private or serving a stale shell: the worker only handles navigations, `/assets/*` and the shell files, and the shell is served `no-cache`.

## Implementation notes
- `web/sw.js` is the source; a tiny Vite plugin (`serviceWorker()` in `vite.config.js`, build only) emits it as `dist/sw.js` with `'__BUILD__'` replaced by a base-36 timestamp. The cache is named after that id, and `activate` deletes the others.
- `routeFor(request, origin)` is the one decision point (navigate / asset / shell / null) and is unit-tested by evaluating the script in a stand-in worker scope (the web package is ESM, so `require` can't load it).
- The worker never calls `respondWith` for anything but those three, so API, uploads, media and the gateway go straight to the network and are never cached.
- `registerServiceWorker` runs only in production builds (`import.meta.env.PROD`); the dev server has no worker. The update toast lasts ten minutes; "Reload" posts `SKIP_WAITING` and the page reloads once on `controllerchange`.
- `static.js`: `index.html` (also the SPA fallback), `sw.js` and `manifest.json` are `Cache-Control: no-cache`; `/assets/*` unchanged (immutable).
- The manifest gained `id`, `scope` and a description; `index.html` the two Apple PWA metas.

## Evidence (2026-10-18)
| Acceptance criterion | Evidence |
|---|---|
| Server: cache headers | `server/tests/static.test.js` with a temp `WEB_DIST`: `/`, `/index.html`, `/sw.js`, `/manifest.json` and an unknown client route are `no-cache`; `/assets/index-abc.js` is `immutable`. Server suite: 26 suites, 252 tests |
| Web: registration and updates | `pwa.test.js` (3): disabled or unsupported does nothing; registers `/sw.js`; a worker installed behind a controller calls `onUpdate`, applying posts `SKIP_WAITING`, and `controllerchange` reloads once; a first install isn't an update, a worker already waiting is |
| Web: worker routing and build id | `sw.test.js` (2): navigations, `/assets/*` and the shell files are handled; `/spaces`, `/dms`, `/uploads`, `/media`, `/me`, `/search`, `/admin`, a POST and another origin are not; `dist/sw.js` carries a build id. Web suite: 61 files, 520 tests; `vite build` emits `dist/sw.js` (3 kB) and `dist/offline.html` |
| Sandbox (production build on :3005) | After the first load the worker was registered and activated; `/sw.js` and `/` came back `no-cache`. After a reload the page was controlled, with one cache `disgourd-<id>` holding only `/offline.html`, the manifest, the icons, `theme-init.js` and the fingerprinted `/assets/*` (fonts, CSS, JS); nothing under `/spaces`, `/dms`, `/uploads`, `/media`, `/me` or `/search`. A rebuild (new id) and a reload showed the toast "A new version of DisGourd is ready. Reload" with the new worker waiting; pressing Reload swapped to it, the old cache was deleted and the toast was gone. No console errors |
