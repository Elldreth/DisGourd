# P2-20c — kie.ai engine (paid models, prices, credit cap)

- **Unit Type:** Implementation (child of P2-20)
- **Phase:** 2
- **State:** COMPLETE (merged #126)
- **Effort:** M
- **Depends on:** P2-20a (engine interface, runner), P2-20b (settings screen), P2-20d (chat panel)
- **Starting baseline:** main at 9daf70a (#124 merged)
- **Serialize with:** `server/imagine/*`, `server/routes/admin.js`, `ImagineAdmin.jsx`, `ImaginePanel.jsx`

## Research (docs.kie.ai and kie.ai/market, 2026-10-18)
- **One API for every image model:**
  - `POST https://api.kie.ai/api/v1/jobs/createTask` with `{ model, input }` → `{ code, msg, data: { taskId } }`;
  - `GET /api/v1/jobs/recordInfo?taskId=` → `data.state` (`waiting | queuing | generating | success | fail`), `resultJson` (a JSON string, `{ resultUrls: [] }`), `failCode`, `failMsg`, `creditsConsumed`, `costTime`;
  - `GET /api/v1/chat/credit` gives the account's credits;
  - auth is `Authorization: Bearer <key>`;
  - error codes: 401 bad key, 402 out of credits, 429 rate limited, 422/500 unprocessable.
- **Content filtering:** most newer models take `nsfw_checker` (boolean). The docs: "Defaults to false. When false, no additional content filtering is applied and results are returned directly by the model." Qwen also has `enable_safety_checker`, "always enabled in Playground… can only be disabled by setting false through the API". Nano Banana 2 has no switch (Google filters it upstream). Grok's "Spicy" mode is for video; the image endpoint offers `nsfw_checker` and `enable_pro` only.
- **Prices:** kie.ai's market page shows Z-Image at "0.8 Credits/image" ($0.004, so 1 credit ≈ $0.005) and Flux-2 from 5 credits. Most others aren't shown, and prices change. So the engine records the real `creditsConsumed` of every image and shows the **last real price** per model and quality, with an estimate (marked "≈ est.") only until then.

## Scope
- **`server/imagine/engines/kie.js`** (registered as `kie`):
  - **Config:** `{ enabled, apiKey, model, monthlyCredits }`. The key is write-only (never returned; shown as "saved, ends in ••••abcd"). The `KIEAI_API_KEY` env var, when set, overrides it.
  - **Catalogue:** text-to-image models, each with its `model` id, aspect ratios, how Quality maps (resolution or quality tier), its safety switch, and an estimate:

    | Model | `model` id | Quality | Safety switch | Estimate |
    |---|---|---|---|---|
    | Z-Image | `z-image` | single quality | `nsfw_checker` | 0.8 |
    | Flux-2 Pro | `flux-2/pro-text-to-image` | 1K / 1K / 2K | `nsfw_checker` | — |
    | Seedream 5.0 Lite | `seedream/5-lite-text-to-image` | basic / basic / high | `nsfw_checker` | — |
    | Qwen Image | `qwen/text-to-image` | steps 20 / 30 / 45 | `enable_safety_checker` + `nsfw_checker` | — |
    | Grok Imagine | `grok-imagine/text-to-image` | single quality | `nsfw_checker` | — |
    | Nano Banana 2 | `nano-banana-2` | 1K / 1K / 2K | none (always filtered) | — |
  - **Custom model ID** (the user, 2026-10-18: prices change and new models arrive): besides the catalogue, an admin can type any kie.ai `model` id. It's sent with the inputs most newer image models share: `prompt`, `aspect_ratio` (1:1 / 3:4 / 4:3 / 16:9) and `nsfw_checker`. Its price is learned from use.
  - **Shapes:** Square 1:1, Portrait 2:3 (3:4 where 2:3 isn't offered), Landscape 3:2 (else 4:3), Wide 16:9. Qwen uses its named sizes.
  - **Safety:** everywhere but a permissive (18+) request, the model's switch is on (`nsfw_checker: true`, and Qwen's checker on); permissive turns them off. Nano Banana 2 is always filtered by Google.
  - **Generating:** createTask → poll recordInfo (default every 2 s) → download every result URL through `safeFetch` (public addresses only, images only, ≤ 20 MB). On abort it stops polling; kie.ai has no cancel, so the task may still finish and be charged.
  - **Errors in plain words:** a bad key, out of credits, rate limited, the model refused the prompt (fail messages about safety or sensitive content → `REFUSED`), or kie.ai's own message.
  - **Price:** `priceFor(cfg, quality)` is the last `creditsConsumed` recorded for that model and quality (from `imagine_jobs`), else the catalogue estimate, else unknown. A job's cost is the real `creditsConsumed`.
- **Monthly credit cap:** before a kie.ai request, this calendar month's recorded credits plus the expected price must stay within `monthlyCredits` (0 or empty = no cap). Otherwise the request is refused with a new `BUDGET` code: "This instance's kie.ai budget for the month is used up".
- **Admin API:** `POST /admin/imagine/kie/test { apiKey? }` checks a key (the given one, or the saved one) and returns the credit balance.
- **Settings → Image generation:**
  - a kie.ai card:
    - an Enable switch;
    - the API key (a password field, with "a key is saved" and Test key → balance);
    - the model dropdown with each model's safety note and last known price;
    - the monthly credit cap;
    - a link to kie.ai's pricing page (https://kie.ai/pricing) and model list (https://kie.ai/market), so the server owner can check current prices and new models;
  - when both engines are on, "Default engine";
  - the test image box gains an engine choice.
- **Chat panel:** when the chosen engine is kie.ai, the panel shows the price: "≈ 0.8 credits" (estimate) or "0.8 credits" (last real).

## Decisions (user, 2026-10-18)
| Question | Decision |
|---|---|
| Prices and new models | They change over time; it's up to the server owner to check. The settings link to kie.ai's pricing page. DisGourd shows the last real price it recorded, and allows a custom model ID. |

## Non-goals
Image editing / image-to-image; video and music; kie.ai webhooks (polling is enough here); per-user spending caps (the daily image count still applies).

## Acceptance criteria
- [x] `imagine-kie.test.js` against a mock kie.ai server:
  - the request body per model (model id, aspect / size, quality mapping, safety switches on, off when permissive, none for Nano Banana 2);
  - polling to success downloads the images, and the job cost is `creditsConsumed`;
  - fail states and HTTP errors map to plain reasons (401, 402, 429, a refusal);
  - abort stops polling;
  - config validation and key masking (the key never appears in admin responses);
  - the env key override;
  - `priceFor` uses the last recorded cost, else the estimate;
  - the monthly cap refuses with `BUDGET`;
  - the test-key route is site-admin only and returns the balance.
- [x] Web tests: the kie.ai card (enable, key field never shows the saved key, Test key shows the balance, model and cap saved); the default engine when both are on; the test-image engine choice; the panel's price line.
- [x] All suites pass; `vite build` is clean.
- [x] Live, with the user's key from `.env`, on the sandbox: Test key shows the balance; one Z-Image test image (≈ 0.8 credits) succeeds and records its cost; the chat panel shows the price.

## Expected Areas of Change
`server/imagine/engines/kie.js` (new), `server/imagine/index.js`, `server/imagine/runner.js`, `server/db/index.js`, `server/routes/admin.js`, `server/tests/imagine-kie.test.js` (new); `web/src/components/ImagineAdmin.jsx` + test, `ImaginePanel.jsx`, `Composer.imagine.test.jsx`, `web/src/api.js`.

## Working Set / Blast Radius
~12 files. Nothing changes until a site admin enables kie.ai with a key.

## Implementation notes
- **Engine extras:** `priceFor(cfg, quality)`, `monthlyCap(cfg)`, `catalogue(cfg)` (the admin view's model list with prices), `testKey(key)`, `keyOf(cfg)`. `imagine/index.js` uses them generically: `overBudget` for the `BUDGET` refusal (chat and test images), and `enginePrices` adds `price` per quality to each engine in `GET /spaces`.
- **Prices learn from use:** `db.lastImagineCost(engine, model, quality)` reads the newest done job with a cost; `db.imagineCreditsSince(engine, monthStart)` sums the month, including queued and running estimates (failures are excluded).
- **Admin test images now record a job** (no server, so `countImagineJobsSince` ignores them for daily limits). That way a test image's real cost teaches the price and counts toward the monthly cap.
- `KIE_API_BASE` (tests) points the engine at a mock, and `IMAGINE_KIE_POLL_MS` sets the polling interval. Downloads use `safeFetch` (public addresses; loopback allowed only under `NODE_ENV=test`), images only, ≤ 20 MB.
- Clearing the key (`apiKey: null`) is refused while kie.ai is switched on, so an engine can't be left on with no key.

## Discovered work
- **Not fixed (pre-existing, PWA):** the "A new version of DisGourd is ready · Reload" notice sits over the bottom of the chat, and covered the /imagine panel's engine chips until dismissed. It only shows right after an update, but it should sit clear of the composer (or above the panel).
- The test file's mock server needed `closeAllConnections()` at shutdown; otherwise Node's fetch keeps the connection alive and Jest never exits. Worth remembering for future mock-server tests.

## Evidence (2026-10-18)
| Acceptance criterion | Evidence |
|---|---|
| Engine against a mock kie.ai | `imagine-kie.test.js` (11). Request bodies: Z-Image `{prompt, aspect_ratio: 1:1, nsfw_checker: true}`; Flux-2 Pro landscape/high `3:2` + `2K`; Seedream wide/draft `16:9` + `basic` + png; Grok portrait `2:3`; Z-Image portrait falls back to `3:4`; Qwen portrait/high `portrait_4_3`, 45 steps, both checkers on; Nano Banana 2 has no `nsfw_checker`; a custom id gets the shared inputs. Permissive turns the switches off. create → poll → download returns the PNG with cost 0.8 and the Bearer key. Plain reasons for 401, 402, 429, a refusal (`REFUSED`), a failure, and no key. Abort stops polling. Validation: model, custom id, key needed to enable, cap ≥ 0; a blank key keeps the saved one; null clears it (not while enabled). `publicConfig` hides the key (hint `••••1234`). The env key overrides. Price: estimate 0.8 for Z-Image; unknown for Flux-2; 5.5 after a recorded job, learned per quality. Routes: test key 403 for non-admins, the wrong key explained, the balance for a given or saved key; the admin view never contains the key and lists the models with prices; a chat request runs on kie.ai with cost 0.8 and price in `GET /spaces`, then `BUDGET` once the cap would be exceeded |
| Web | `ImagineAdmin.test.jsx` (5): the saved key is never shown (a password field with the hint); Test key sends blank and shows the balance; the model options read "Z-Image — ≈ 0.8 credits (est.)", "Flux-2 Pro — 5.5 credits", "Nano Banana 2 — price unknown until first use", "Custom model ID…"; the pricing link; Save sends the new key once and clears the field; the environment key; a custom id; the default engine radio; the test image engine choice and "4.2 s · 0.8 credits". `Composer.imagine.test.jsx` (9): no price for ComfyUI; "≈ 0.8 credits" for kie.ai at Standard, "5.5 credits" at High |
| Suites | Web: 68 files, 586 tests. Server: 33 suites, 312 tests. `vite build` clean |
| Live (sandbox :3005, the user's key from `.env`) | Settings → Image generation showed "Using the KIEAI_API_KEY set in the server's environment" (no key field). Test key: "The key works · 8017.5 credits left". Z-Image selected, kie.ai on, cap 50, saved; the default-engine choice appeared. Generate a test image on kie.ai ("a friendly gourd wearing a top hat, storybook illustration"): 1024×1024 PNG, "7.0 s · 0.8 credits". In chat, the /imagine panel with kie.ai chosen read "0.8 credits · 5 left today" (the real price; Draft and High still estimates). Total spent: 0.8 credits (about $0.004) |
