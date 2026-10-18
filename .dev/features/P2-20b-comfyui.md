# P2-20b — ComfyUI engine and the Image generation settings section

- **Unit Type:** Implementation (child of P2-20)
- **Phase:** 2
- **State:** REVIEW
- **Effort:** M
- **Depends on:** P2-20a (engine interface, settings, runner)
- **Starting baseline:** main at 383cbd8 (#121 merged)
- **Serialize with:** `server/imagine/*`, `server/routes/admin.js`, `web/src/components/ProfileDialog.jsx`, `web/src/api.js`

## Why
The free, local engine, plus somewhere to set it up. The user, 2026-10-18: "when I go into settings I can enable 'imagine' and select from my models which one to use". The user also asked that the settings section come in this step rather than P2-20d.

## Scope
- **`server/imagine/engines/comfyui.js`** (registered as `comfyui`):
  - **Config:** `{ enabled, url, model, family, tier }`.
    - `url` is http(s) (any host; only site admins can set it, so LAN addresses are allowed and calls don't go through `safeFetch`).
    - `model` is a checkpoint name as ComfyUI lists it.
    - `family` is `sd15 | sdxl | flux`.
    - `tier` is `low | medium | high`.
    - Nothing in it is secret.
  - **Models:** `listModels(url)` reads `GET /object_info/CheckpointLoaderSimple`. Each name gets a guessed family from its folder and name (`flux` → Flux; `sd1`, `sd15`, `1.5` → SD 1.5; `xl`, `illustrious`, `pony`, `noob` → SDXL; otherwise SDXL). The admin can change the guess.
  - **Templates** (API-format workflows built in code):
    - **SD 1.5 / SDXL:** CheckpointLoaderSimple → CLIPTextEncode (prompt, negative) → EmptyLatentImage → KSampler → VAEDecode → SaveImage.
    - **Flux:** the same with FluxGuidance (3.5), EmptySD3LatentImage and CFG 1.
  - **Quality per family:** steps, CFG, sampler, scheduler, and a target pixel count:
    - SD 1.5 ≈ 0.26 / 0.33 / 0.45 MP;
    - SDXL ≈ 0.8 / 1.0 / 1.15 MP;
    - Flux ≈ 0.6 / 1.0 / 1.6 MP.
  - **VRAM tier** caps the pixels: Low 1.0 MP, Medium 1.5 MP, High 2.4 MP.
  - **Sizes:** shapes 1:1, 2:3, 3:2 and 16:9 at that pixel count, rounded to multiples of 64.
  - **Seeds:** random.
  - **Generating:**
    - `POST /prompt` → poll `GET /history/:id` → fetch each output with `GET /view`.
    - On abort (the runner's timeout), remove the prompt from ComfyUI's queue, or interrupt it if it's running.
    - Errors mapped to plain reasons: not reachable, model not found (node errors), ComfyUI's own failure.
  - **Content:** ComfyUI has no filter. Outside 18+ channels, SD 1.5 / SDXL get `nsfw, nude, nudity` added to the negative prompt. That's a nudge, not a filter, and Flux at CFG 1 ignores negatives. The settings screen says so plainly.
- **Admin API** (site admins only):
  - `POST /admin/imagine/comfyui/test { url }` → `{ models: [{ name, family }] }` or a 400 with the reason.
  - `POST /admin/imagine/try { engine, prompt, shape, quality }` → one image straight from the engine (no chat message, no daily count, the same always-refused check), saved under uploads → `{ url, width, height, ms }`.
- **App:** Settings → *Site admin* → **Image generation** (`ImagineAdmin.jsx`):
  - **ComfyUI:**
    - an Enable switch;
    - the address with **Test connection**;
    - the **model dropdown** (from the server's list; the type guessed and changeable);
    - the VRAM tier (Low ≤ 8 GB / Medium 12–16 GB / High 24 GB+);
    - Save.
  - **For everyone:**
    - the daily images per person;
    - "Allow unfiltered images in 18+ channels", with the plain notice about what ComfyUI does and doesn't filter, and that the host is responsible.
  - **Generate a test image:** a prompt, shape and quality, the result shown inline, with how long it took.
  - A line saying server owners still turn `/imagine` on for their own server, and that the chat panel comes next (P2-20d).

## Non-goals
Standalone diffusion models that need separate text-encoder / VAE loaders (a follow-up); user-uploaded workflows; LoRAs; hires-fix / upscaling; the chat `/imagine` panel and per-server switches (P2-20d); kie.ai (P2-20c).

## Acceptance criteria
- [x] `imagine-comfyui.test.js` against a mock ComfyUI (a local HTTP server):
  - the model list and family guesses;
  - each family's workflow (nodes, model, size, steps, the negative nudge only when not permissive);
  - sizes per shape, quality and tier (multiples of 64, within the cap);
  - a full generation (prompt → history → view → image bytes);
  - unreachable, model-not-found and ComfyUI-error mapping;
  - abort removes or interrupts the prompt;
  - config validation (bad URL, tier, family).
- [x] Admin routes: test connection and try are site-admin only; `try` refuses the always-refused prompts and returns a saved image.
- [x] `ImagineAdmin.test.jsx`: loads the settings; Test connection fills the model list and guesses the type; Save sends the config; a test image shows with its timing; errors are shown.
- [x] All existing suites pass; `vite build` is clean.
- [x] Live (sandbox app, the user's ComfyUI at `127.0.0.1:8188`):
  - set it up in Settings and Test connection (the model list appears);
  - generate a test image with an SDXL checkpoint and a Flux checkpoint;
  - one `/imagine` request through the chat path (sent as sandy) produces the image in a channel.

## Expected Areas of Change
`server/imagine/engines/comfyui.js` (new), `server/imagine/index.js`, `server/routes/admin.js`, `server/tests/imagine-comfyui.test.js` (new), `web/src/api.js`, `web/src/components/ImagineAdmin.jsx` (new) + test, `web/src/components/ProfileDialog.jsx`.

## Working Set / Blast Radius
~8 files. Nothing changes for anyone until a site admin enables ComfyUI.

## Implementation notes
- Images use **PreviewImage** (ComfyUI's temp folder) rather than SaveImage, so DisGourd's images don't pile up in the user's ComfyUI output folder; `/view` fetches them with `type=temp`.
- The tier caps allow up to 10% over after rounding to 64. Without it, a Low-tier square came out 960×1024 (shapes stay true this way).
- **Family guess:** "flux" anywhere → Flux; an `SD1` folder, `sd15`, `v1-5` or `1.5` → SD 1.5; everything else → SDXL. On the user's library this gave Flux for `Flux\flux1-dev-fp8`, SDXL for `Illustrious\…`, and SD 1.5 for the `SD1\…` merges.
- `POST /admin/imagine/try` runs the engine directly (ComfyUI keeps its own queue), returns the saved upload URL, and doesn't count against anyone's daily limit.
- The settings section tests a saved address when it opens, so the model list is ready.

## Discovered work
- **Dev server proxy (pre-existing, not part of this unit):** `web/vite.config.js` proxies only `/register`, `/login`, `/auth-info`, `/uploads`, `/media`, `/spaces`, `/friends`, `/admin` and `/push`. Not `/me`, `/dms`, `/search` or `/invites`. On the Vite dev server (`npm run dev`, the sandbox's :5174) the profile therefore never loads: no site-admin sections, and DMs, search and invite links fail. Production serves everything from one origin and is unaffected. The live check used the sandbox server's built app on :3005 instead. Proposed as its own small fix.
- Standalone diffusion models (the user has 14, e.g. Z-Image Turbo, Krea 2) need separate text-encoder and VAE loaders. Left for a follow-up, as planned.

## Evidence (2026-10-18)
| Acceptance criterion | Evidence |
|---|---|
| Engine against a mock ComfyUI | `imagine-comfyui.test.js` (11): the model list with guesses (flux / sdxl / sd15). The SDXL workflow: checkpoint, 1024×1024, 28 steps, CFG 6, dpmpp_2m karras, PreviewImage; the "nsfw, nude, nudity" negative only when not permissive. SD 1.5 draft is 512×512. Flux: FluxGuidance 3.5, EmptySD3LatentImage, CFG 1, euler / simple, empty negative. Every family × quality × shape × tier is a multiple of 64 and within the cap (+10%). A generation goes prompt → history → view, returning the bytes. A missing model, an unreachable server and a ComfyUI execution error each come out as one plain sentence. Aborting a running job calls /interrupt; aborting a queued one deletes it from the queue. Config validation (bad URL, scheme, credentials, type, tier; turning it on needs an address and a model) |
| Admin routes and the chat path | Same file: test connection is 403 for a non-admin, 400 for a bad address, and explains an unreachable one; it normalises the trailing slash and returns the models. Saving the ComfyUI config round-trips (type guessed as Flux). `try` is 403 for a non-admin, 400 for an always-refused prompt, and returns a saved 1024×576 image. A chat `imagine` op on a server with ComfyUI as the default engine posts the image, and the job records engine `comfyui` and the model |
| Settings section | `ImagineAdmin.test.jsx` (3): Test connection lists the models; picking one sets the type; Save sends the engine config, default engine, limit and switch; "Saved" shows. A saved address is tested on open; connection and save errors are shown. The test image needs a saved model, then shows the picture with "1024×576 · 14.9 s"; refusals are shown. `ProfileDialog.test.jsx` now also opens the Image generation tab |
| Suites | Server: 32 suites, 301 tests (one existing assertion now finds the fake engine by id, since the list includes ComfyUI). Web: 65 files, 566 tests. `vite build` clean |
| Live, on the user's ComfyUI (127.0.0.1:8188, ComfyUI 0.35.1, 32 GB) | Direct engine calls: Illustrious-XL (SDXL, Draft) gave 896×896 in 22.8 s including the model load; flux1-dev-fp8 (Flux, Draft) gave 768×768 in 14.9 s. In the sandbox app's Settings → Image generation (built app on :3005, as sandy): Test connection showed "Connected · 141 checkpoints"; picking `Flux\flux1-dev-fp8.safetensors` set the type to Flux; High tier; switched on; Saved. **Generate a test image** (Wide, Standard, "a cozy cabin in a snowy forest at dusk…") showed 1344×768 · 9.4 s. A chat `/imagine` request as sandy in Tx Check #general went "1st in line" → "generating" → the image (a lighthouse in a storm) in about 10 s |
