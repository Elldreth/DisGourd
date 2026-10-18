# P3-19 — The "new version" notice stays clear of the composer

- **Unit Type:** Implementation (UI polish fix)
- **Phase:** 3
- **State:** REVIEW
- **Effort:** S
- **Depends on:** P2-18a (service worker update notice), P3-09 (toasts)
- **Serialize with:** `web/src/components/Toasts.jsx`

## Problem
When a new build is installed behind the open one, the app shows "A new version of DisGourd is ready · Reload" (P2-18a). It is a toast, and every toast sits at the bottom of the screen (`bottom-20`), right over the composer and whatever opens above it: the /imagine panel, mention and command suggestions, the reply bar. It stays up for ten minutes. While live-testing /imagine (P2-20c, PR #126) a click meant for the "kie.ai" engine button landed on the notice instead. It also has no way to close it short of reloading.

## Scope
1. Toasts take an optional `placement: 'top'`. Top toasts show just under the 48px headers (over the top of the message list), away from the composer. Bottom stays the default, so "Message deleted · Undo" keeps its place.
2. Toasts take an optional `dismissible: true`, which adds a close (×) button labelled "Dismiss".
3. The update notice uses both.
4. Both lists stay inside the one polite live region (`role=status`); the Reload button stays in the normal Tab order and nothing takes focus.

## Acceptance criteria
- [x] The update notice renders at the top of the screen, not in the bottom list over the composer.
- [x] The notice has a keyboard-reachable Reload button and a Dismiss button; Dismiss removes it without reloading.
- [x] Other toasts keep their bottom placement and behaviour.
- [x] Web suite and `vite build` pass.

## Expected Areas of Change
`web/src/components/Toasts.jsx`, `web/src/components/Toasts.test.jsx`, `web/src/App.jsx` (one call).

## Working Set / Blast Radius
3 files, client only.

## Evidence (2026-10-18)
| Acceptance criterion | Evidence |
|---|---|
| Notice at the top, not over the composer | `Toasts.test.jsx` "a top toast (the update notice) shows in the top list…". Live: a throwaway server on :3007 (a copy of the sandbox DB, this branch's build). Changing `dist/sw.js` and calling `registration.update()` raised the real notice at y 56–96 px; the composer was at y 704–740 (1024 wide), and it sat just under the header at 375 px wide |
| Reload reachable, Dismiss works | `Toasts.test.jsx` "a dismissible toast closes from its Dismiss button without running its action". Live: Dismiss emptied the live region, the page did not reload, and the new worker stayed waiting |
| Other toasts unchanged | `Toasts.test.jsx` existing tests, plus "toasts are not dismissible unless asked" and the bottom-list check |
| Suites pass | Web: 69 files, 591 tests. `vite build` clean |

## Discovered Work
- The "Message deleted · Undo" toast still uses the bottom list, so for its 5 seconds it can cover the composer's top edge or an open /imagine panel. Left as is: it is short-lived and sits next to the message you just acted on. Moving it is a separate call.
