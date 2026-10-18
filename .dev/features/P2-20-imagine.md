# P2-20 — `/imagine`: image generation with two engines, local ComfyUI or kie.ai (Container)

- **Unit Type:** Container
- **Phase:** 2, rank 12
- **State:** PLANNED (design agreed with the user 2026-10-18; P2-20a COMPLETE #121; P2-20b COMPLETE #122; P2-20d COMPLETE #124; P2-20c ACTIVE)
- **Effort:** L in total (four children)
- **Requirement Source:** IMPROVEMENT-PLAN.md Phase 2 #12, reshaped in conversation with the user on 2026-10-18 (this packet replaces the earlier kie.ai-only sketch)

## What the user wants
- `/imagine` generates images in chat. It is **optional**: off unless the instance enables it.
- **Two engines, either or both:**
  - **ComfyUI**: a local server the instance points at by address and port. Free, private, and unfiltered.
  - **kie.ai**: a paid service with an API key. It offers a choice of models and shows prices, so the server owner knows what it will cost.
- **The same options on both engines**, so results feel alike whichever one runs. For ComfyUI, a **VRAM tier** (Low / Medium / High) sets the largest image the hardware is asked for.

## Design

### One request shape, two engines
People choose from the same small set; each engine translates it into its own settings.

| Option | Values | ComfyUI | kie.ai |
|---|---|---|---|
| Prompt | text, ≤ 1,000 characters | into the workflow template | into the API request |
| Shape | Square, Portrait (2:3), Landscape (3:2), Wide (16:9) | width × height for the tier's maximum, rounded to multiples of 64 | the model's aspect-ratio parameter |
| Quality | Draft, Standard, High | steps and resolution (and the template's sampler settings) | the model or quality level the admin mapped to it, with its price |
| Seed | optional, for Retry / Variations later | the sampler seed | the model's seed where it has one |

**Results look alike only when the models are alike.** The admin page recommends the same model family on both engines (for example Flux on kie.ai and Flux in ComfyUI); nothing promises an identical look.

### Engine interface (server)
`server/imagine/engines/{fake,comfyui,kie}.js`, each with:
- `describe()`: models, shapes, quality mapping, price per image (kie.ai) and whether a permissive mode exists.
- `generate(request, { permissive, signal, onProgress })`: returns `{ images: [{ buffer, contentType }] }`, or throws a typed error such as `REFUSED`, `TIMEOUT`, `QUOTA` or `UNAVAILABLE`.

`onProgress` reports the queue position or "generating". Results are stored in `UPLOADS_DIR` like any upload.

### Who controls what
1. **Instance (site admins), on the admin page:**
   - **ComfyUI:** URL, VRAM tier, workflow template, model (read from the ComfyUI server).
   - **kie.ai:** API key, the models offered, a monthly credit cap.
   - **Which engine is the default** when both are on.
   - The kie.ai key is write-only: stored on the server, shown masked, never sent to browsers. The `KIEAI_API_KEY` env var, when set, overrides it.
   - The ComfyUI address is trusted because only site admins can set it. So ComfyUI calls use a direct connection, not `safeFetch`, which blocks LAN addresses.
2. **Each server's owner:**
   - turns `/imagine` on for their server;
   - picks which roles may use it, through a new **`generate_images`** role permission (not on @everyone by default);
   - can mark channels **Age-restricted (18+)**.
3. **Each user:** a daily limit (instance default, adjustable by the server owner within it). On kie.ai, the cost shows before generating.

### Content rules (NSFW)
- **Off by default everywhere.** Every engine runs at its strictest setting in normal channels and in DMs.
- **Only in channels marked Age-restricted (18+)** does a request run "permissive", and only if the instance admin allowed permissive mode at all:
  - **ComfyUI:** no filter applied.
  - **kie.ai:** each model in the catalogue declares its knob, and DisGourd sets it:
    - Flux Kontext `safety_tolerance` (0–6, 6 most permissive; editing only up to 2);
    - Qwen `enable_safety_checker` (to be confirmed that `false` is honoured);
    - Grok Imagine "Spicy" (mainly video; to be confirmed for images);
    - none for Nano Banana / GPT Image, which are always filtered upstream.
- The admin page states plainly per model what "permissive" means. It also warns that kie.ai can suspend an account at its discretion: their [Terms of Use](https://kie.ai/terms-of-use) don't mention adult content, but forbid "otherwise inappropriate" content.
- Prompts that ask for minors in sexual content, or for sexual images of real, named people, are refused in every channel, by a server-side check before any engine is called. Whoever runs the instance is responsible for what it hosts.

### In chat
- `/imagine` opens a small panel:
  - prompt, shape and quality;
  - the engine (if both are on);
  - the price on kie.ai;
  - "N left today".
- A bot user posts "🎨 imagining… (2nd in line)" and replaces it with the image when it's done, or with the error.
- Later: Retry and Variations buttons on the result.

## Children
| ID | Title | Depends on | Acceptance (summary) |
|---|---|---|---|
| P2-20a | Imagine core: bot user, settings, permission, limits, fake engine | P2-21 (roles), P1-05 | Migration: `users.is_bot`, `channels.nsfw`, `imagine_jobs` (who, where, engine, model, cost, status, timestamps), instance settings for the engines. A bot user that can't log in; `postAsBot` / `updateMessage` with attachments (and `message_update` carrying them). A `generate_images` role action. A per-server toggle, a daily per-user limit and a monthly kie.ai credit cap, all enforced in an `imagine` gateway op. A job runner (one at a time per engine, a 5-minute timeout, queue-position frames). The `fake` engine for tests. The prompt check for the always-refused cases. Tests cover each rule; no real engine is called. |
| P2-20b | ComfyUI engine | P2-20a | `comfyui.js` talks to the configured URL (`/object_info` for models, `/prompt` to queue, `/history` or the websocket for completion, `/view` for the image). Shipped API-format workflow templates with placeholders for prompt, negative, width, height, steps, seed and model: one SDXL template and one Flux template, each tuned to look good at Draft / Standard / High. VRAM tiers cap pixels (Low ≈ 1 MP, Medium ≈ 1.5 MP, High ≈ 2.4 MP). An admin "Test connection" button that lists the models. Tested against a mocked ComfyUI, then live against the user's ComfyUI (started with `--listen`). |
| P2-20c | kie.ai engine | P2-20a | `kie.js` with a catalogue of chosen models: for each, its endpoint, shape and quality mapping, price in credits, and safety knob. Async task create + poll; the result downloaded through `safeFetch` restricted to kie.ai's result hosts. The credit cap enforced from the catalogue prices before a call. **Before writing it:** re-read kie.ai's docs and pricing for the chosen models, and confirm each safety knob with a real request. Tests mock the HTTP client. |
| P2-20d | `/imagine` in the app | P2-20a (b or c to use for real) | The `/imagine` panel in the Composer (shape, quality, engine, price, remaining count); the placeholder and queue position; errors inline; a BOT badge. The admin page's kie.ai part (the ComfyUI part and the shared settings moved to P2-20b at the user's request, 2026-10-18). The server-settings toggle and the 18+ channel switch. Tests plus a sandbox run with the fake engine. |

Order: a → b (free, so it can be iterated on the user's own hardware) → c → d. Each is its own PR.

## Decisions (user, 2026-10-18)
| Question | Decision |
|---|---|
| Engines | Both, each optional: local ComfyUI (by address and port) and kie.ai (with a key). |
| Options | The same set on both engines; ComfyUI's maximum resolution follows a Low / Medium / High VRAM tier. |
| NSFW | Investigated kie.ai (above). Off by default; allowed only in channels a server owner marks 18+, and only if the instance allows it. |
| Where ComfyUI runs | Usually on the user's desktop PC; DisGourd (on Unraid) reaches it over the LAN, so it needs `--listen` and a fixed IP. |
| Where the engine is set up | Settings → Site admin → Image generation, with a model dropdown read from ComfyUI; built in P2-20b (moved from P2-20d) so it can be tried as soon as the engine exists. |

## Open questions (resolve when the child starts)
- **P2-20b:** which models the user has installed in ComfyUI, and the GPU's VRAM. This picks the templates to tune first.
- **P2-20c:** which kie.ai models to offer, and their current prices. Check at build time; don't invent them.
- **P2-20a:** default limits: per-user per day, and the monthly kie.ai credit cap.
- Whether `/imagine` should work in DMs at all, or only in servers. Proposed: servers only at first.

## Non-goals (for now)
Video and music generation; image editing (img2img) and uploads as references; user-uploaded workflows (a later option for ComfyUI); a local NSFW classifier.
