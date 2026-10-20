# P9-05a — kie.ai image-to-image: engine and server

- **Unit Type:** Implementation (child of P9-05)
- **Phase:** 9
- **State:** READY (once the P9-05 plan merges)
- **Effort:** M (no migration)
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

## Acceptance criteria
- [ ] Server tests, with kie.ai mocked:
  - each model's i2i input: the image field and whether it's an array, aspect or `auto`, resolution or quality, the safety switches, and Qwen's strength;
  - the upload call (Bearer, base64, `uploadPath`) and its errors;
  - `pictureModel` validation;
  - start from a picture on kie.ai, and on ComfyUI when the panel chose it;
  - a Variation of a kie.ai image runs on kie.ai (`once`, and Subtle on Qwen), and a ComfyUI image's on ComfyUI;
  - with kie.ai only, both features work and Upscale is refused;
  - Retry of a failed kie.ai picture job;
  - `imagineEngine` in history and in update frames;
  - GET /spaces `pictures`.
- [ ] All suites pass.
- [ ] Live: one real kie.ai picture job with the owner's key, on a cheap model (Qwen or Grok, about 4 credits). This spends real credits, so the owner OKs it first.
