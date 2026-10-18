# P2-18 — PWA + Web Push (Container)

- **Unit Type:** Container
- **Phase:** 2, rank 10
- **State:** PLANNED (P2-18a ACTIVE; child packet P2-18a-service-worker.md)
- **Effort:** M (total)
- **Requirement Source:** IMPROVEMENT-PLAN.md Phase 2 #10

## Current state (revalidated)
`web/public/manifest.json` and 192/512 icons already exist and `index.html` links the manifest. There is **no service worker**, so the app isn't installable offline and can't receive push.

## Children
| ID | Title | State | Depends on | Acceptance (summary) |
|---|---|---|---|---|
| P2-18a | Service worker + installable shell | PLANNED | P1-04 (`static.js` must serve `/sw.js` with `Cache-Control: no-cache`) | Hand-written `web/public/sw.js`: network-first for navigations with an offline fallback page, cache-first for `/assets/*`, and **never** caching `/spaces`, `/dms`, `/uploads`, `/gateway` or auth. Lighthouse "installable" passes. A new deploy activates after reload, with an "Update available" toast. |
| P2-18b | Web Push for mentions and DMs while no socket is open | PLANNED | P2-18a, P2-04 (notification prefs), P1-01, P1-05 | VAPID keys generated and persisted like the JWT secret (`/config/.vapid.json`). `push_subscriptions` table. `POST/DELETE /push/subscriptions`. The server sends a push only when the target user has 0 open sockets and isn't in DND (P2-14). Payload: no message content beyond a 100-character preview (opt-out setting). Needs the `web-push` dependency (or a hand-rolled RFC 8291 implementation, not recommended). |

## Why it isn't decomposed further now
Both children depend on Phase 1 outputs, and on P2-04's settings model. Write the full child packets once those land.

## Decisions (user, 2026-10-18)
| Question | Decision |
|---|---|
| iOS Safari push only works once the app is on the Home Screen | **Acceptable.** Push works on Android and desktop as is; on iOS it works after Add to Home Screen, and the app shows a short hint about that. |
| Message previews in push | **On, with an opt-out.** Up to 100 characters of text (never attachments); a setting turns previews off so the notification only says who and where. |
