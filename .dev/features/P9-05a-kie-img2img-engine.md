# P9-05a — kie.ai image-to-image: engine and server

- **Unit Type:** Implementation (child of P9-05)
- **Phase:** 9
- **State:** REVIEW
- **Starting baseline:** main at dcb58db (#187 merged)
- **Effort:** M (migration v29: one index)
- **Depends on:** the P9-05 design

## Scope
- **`engines/kie.js`:**
  - **Picture specs:** each catalogue model gets a `picture` spec: its i2i model id, the image field and whether it's an array, whether it has `strength`, and which of aspect, resolution and quality still apply.
  - **`pictureModel` config:** used when the main model has no picture version (Z-Image, custom). It's required when kie.ai is on and the main model has none, and must be one of the five.
  - **`uploadPicture(buffer, contentType, key)`:**
    - Uploads the picture to kie.ai's file API as base64 (`KIE_UPLOAD_BASE`, default `https://kieai.redpandaai.co`), with `uploadPath: 'disgourd'` and a random file name, and returns `downloadUrl`.
    - Errors are mapped like `apiError`.
    - Files over 10 MB use the stream upload.
  - **`generate` with `request.init`:**
    - Upload first, then build the i2i input.
    - Qwen gets `strength` = the denoise.
    - The shape uses `auto` where the model offers it, else the nearest aspect, as today.
    - Each model's safety switches are kept.
  - **`pictures(cfg)`:** returns `{ strength: bool }`, or null when the setup can't do pictures.
  - **Prices:** `priceFor` and the recorded costs use the i2i model's id for picture jobs.
- **`imagine/index.js`:**
  - **Start from a picture** uses the panel's engine (`msg.engine`, else the default) if it can do pictures. If not, ComfyUI if it's on. Otherwise it refuses: "Starting from a picture needs ComfyUI or a kie.ai model that takes pictures".
  - **Variations:**
    - They use the source job's engine if it's on and can do pictures, else ComfyUI if it's on, else refuse.
    - For a kie.ai model without strength, `vary` takes a new value, `'once'`. Subtle and Strong are also accepted and do the same thing.
    - The message reads "🎲 sandy varied: …" (no strength). The ImagineAgain patterns must accept it; that's in P9-05b.
  - **Upscale** is unchanged (ComfyUI only).
  - **Retry** of a failed kie.ai picture job uses kie.ai again.
- **Bot messages say which engine made them:**
  - MESSAGE_SELECT adds `imagineEngine` to the imagine bot's messages, through a subquery on `imagine_jobs.message_id`. The runner's `message_update` frames carry it too.
  - GET /spaces `imagine` sets `canVary` when any engine can do pictures, and adds `pictures: { comfyui: { strength: true }, kie: { strength: bool } }`.
- **Privacy:** only the one picture for the job is uploaded, nothing else.

## As built
- **`engines/kie.js`:**
  - Each catalogue model has a `picture` spec: model id, field, array or not, `aspect` (`auto`, `nearest` or none), `strength`, `maxBytes`, and an estimate.
  - `pictureEntry(cfg)` returns the main model's picture spec, else `pictureModel`'s.
  - `buildInput` builds the picture input from it; Qwen gets `strength` = the denoise.
  - `uploadPicture` sends base64 up to 10 MB and a multipart stream above that (`KIE_UPLOAD_BASE`). Errors go through the same `kie()` helper.
  - `generate` refuses a picture over the model's limit before uploading.
  - `pictures(cfg)` is exported, and `publicConfig` and `catalogue` show the picture info.
  - `costOf` and `priceFor` use the picture model for picture jobs.
- **`imagine/index.js`:**
  - `canPicture(engine)` picks the engine: a Variation uses the source job's, "Start from a picture" uses `msg.engine` or the default, and a Retry uses the original's. Each falls back to ComfyUI, then refuses with "… ComfyUI or a kie.ai model that takes pictures".
  - On an engine without strength the Variation is named nothing, so the message reads "varied: …". `vary: 'once'` is accepted, and reads as Subtle where there is a strength.
  - GET /spaces `pictures` and `canVary` come from the engines that take pictures. ComfyUI exports `pictures: () => ({ strength: true })`.
- **Messages:** MESSAGE_SELECT adds `imagineEngine` for bot rows (latest job for that message). `hydrateBot` drops it when null. The runner's `message_update` carries it.
- **Changes from the plan:**
  - **`pictureModel` is optional.** With Z-Image or a custom model and no picture model chosen, kie.ai just doesn't take pictures, and ComfyUI handles them if it's on. Requiring the setting would block saving existing Z-Image setups until P9-05b adds the picker.
  - **Migration v29** adds `idx_imagine_jobs_message`, because every bot message now looks up its job.
- **Not in this unit (P9-05b):**
  - The app ignores `imagineEngine` in update frames.
  - "varied: …" (no strength) isn't yet recognized by the Variation buttons, so a kie.ai Variation shows no buttons until 05b.
  - The panel still shows Strength for every engine. The server accepts it and ignores it where there's none.

## Discovered Work
- **kie.ai's Qwen image-to-image was failing on their side on 2026-10-20.** Even kie.ai's own example picture got "Internal Error", charged 0 credits. People see "Couldn't imagine that: kie.ai: Internal Error". Nothing to change here; re-check before relying on Qwen.
- **Grok's picture model keeps the picture very close.** Its Variation of an image came out nearly identical. Worth watching in P9-05b; maybe the button should say so, or the prompt could ask for a change.

## Acceptance criteria
- [x] Server tests, with kie.ai mocked:
  - each model's i2i input: the image field and whether it's an array, aspect or `auto`, resolution or quality, the safety switches, and Qwen's strength;
  - the upload call (Bearer, base64, `uploadPath`) and its errors;
  - `pictureModel` validation;
  - start from a picture on kie.ai, and on ComfyUI when the panel chose it;
  - a Variation of a kie.ai image runs on kie.ai (`once`, and Subtle on Qwen), and a ComfyUI image's on ComfyUI;
  - with kie.ai only, both features work and Upscale is refused;
  - Retry of a failed kie.ai picture job;
  - `imagineEngine` in history and in update frames;
  - GET /spaces `pictures`.
- [x] All suites pass.
- [x] Live: one real kie.ai picture job with the owner's key, on a cheap model (Qwen or Grok, about 4 credits). This spends real credits, so the owner OKs it first.

## Evidence (2026-10-20)
| Acceptance criterion | Evidence |
|---|---|
| Server, kie.ai mocked | `imagine-kie.test.js` (+3):<br>• **Picture inputs:** Flux-2 Pro → `flux-2/pro-image-to-image`, `aspect_ratio: auto`, `resolution: 2K`, `input_urls: [url]`. Seedream → `16:9`, `quality`, `image_urls`. Qwen → `image_url`, `strength: 0.3`, both switches off when permissive, no aspect. Grok → only prompt, `nsfw_checker`, `image_urls`. Nano Banana → `image_input: [url]`, `auto`. Z-Image refuses; with `pictureModel` it uses that model. `pictures()`, validation ("Pick a model for pictures"), `publicConfig`, `catalogue` and the picture price (Grok 4, estimate).<br>• **Upload:** base64 data URI, `uploadPath: disgourd`, `disgourd-<hex>.png`, Bearer; the task gets the returned URL and `strength: 0.65`. Over 10 MB → multipart stream (Nano Banana). Too big for Grok → refused before uploading. Upload error → "kie.ai: upload failed"; wrong key → "kie.ai rejected the API key".<br>• **Chat:** Qwen picture job → `img2img`, `qwen/image-to-image`, strength 0.65, one upload. `imagineEngine: 'kie'` in history and in the update frame, not on people's messages. Subtle on Qwen → "varied (subtle)". Grok `once` and `strong` → "🎲 **admin** varied: …", input with no strength or aspect. Upscale → NO_ENGINE. A failed picture job retried on kie.ai. Z-Image without a picture model → `canVary: false`, `pictures: {}`, start-from-picture refused with the new text. With ComfyUI on: the panel's engine decides (`comfyui` / `kie`); a ComfyUI image's Variation → ComfyUI, a kie.ai image's → kie.ai; kie.ai off → ComfyUI.<br>`db-migrations.test.js`: the new index is in the list |
| All suites | Server 50 files, 447 |
| Live (sandbox :3005, the owner's key from the environment; OK'd ~8 credits) | GET /spaces `pictures: { comfyui: { strength: true }, kie: { strength: true / false } }`. The upload alone was probed separately (free): `downloadUrl` returned the same 1,608,798 bytes. **Qwen:** two DisGourd jobs and two direct minimal tasks, one with kie.ai's own example picture, all failed "Internal Error" at 0 credits (their side). **Grok** (the sandbox's model): "Start from a picture" from the Photoreal gourd, with "…at night, moonlight" → job 96 `kie img2img grok-imagine/image-to-image`, 4 credits, a moonlit version of the same gourd, 17 s, message "🎨 sandy imagined: …", `imagineEngine: kie`. Subtle variation of it → job 97 `vary`, 4 credits, "🎲 sandy varied: …" (no strength, as Grok has none), nearly identical, 18 s. Balance 7,916.4 → 7,908.4. The kie.ai model was set back to Grok afterwards. Sandbox DB is at v29 |
