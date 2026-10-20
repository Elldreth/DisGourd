# P9-05 — kie.ai image-to-image

- **Unit Type:** Container (children: P9-05a, P9-05b)
- **Phase:** 9
- **State:** COMPLETE (#187–#189)
- **Effort:** M–L
- **Depends on:** P2-20c (kie.ai engine), P3-36a (Variations), P3-36b (Start from a picture)

## Why
Today "Start from a picture" and Variations only work with ComfyUI. An instance that runs only kie.ai can't use them, and a kie.ai image can only be varied by ComfyUI.

## Decisions (owner, 2026-10-20)
- **Both features run on kie.ai.**
  - "Start from a picture" uses kie.ai when kie.ai is the engine chosen in the panel.
  - A Variation runs on the engine that made the image: kie.ai images on kie.ai, ComfyUI images on ComfyUI.
  - On an instance with only kie.ai, both features work.
  - Upscale stays ComfyUI-only.
- **Strength:**
  - Only Qwen's picture model has a strength setting.
  - For the other kie.ai models, the Strength chips are hidden, with a short note: "The picture guides the image; your prompt says what to change."
  - Variations of those images offer one **Variation** button instead of Subtle and Strong.
  - Qwen keeps Subtle / Medium / Strong, mapped to its `strength` the way ComfyUI's denoise is.
- **The picture model follows the main kie.ai model:**

  | Main model | Picture model |
  |---|---|
  | Flux-2 Pro | `flux-2/pro-image-to-image` |
  | Seedream 5 Lite | `seedream/5-lite-image-to-image` |
  | Qwen | `qwen/image-to-image` |
  | Grok Imagine | `grok-imagine/image-to-image` |
  | Nano Banana 2 | the same id, with `image_input` |

  Z-Image and custom models have no picture version, so Settings asks for a **Model for pictures** (one of the five above) when one of them is the main model.
- **Upload:**
  - kie.ai can't reach this server, so the picture is first uploaded to kie.ai's file storage, and the job sends the URL it returns.
  - Uploads are free, and kie.ai deletes them after 24 hours.
  - The kie.ai settings page says so. There's no on/off switch.

## Facts from kie.ai's docs (read 2026-10-20; docs.kie.ai and the market pages)

| Model | Image field | Limits | Other fields |
|---|---|---|---|
| Flux-2 Pro i2i | `input_urls[]` | 1–8 images, 10 MB each | `aspect_ratio` (adds `auto`), `resolution`, `nsfw_checker` |
| Seedream 5 Lite i2i | `image_urls[]` | up to 14 images, 30 MB | `aspect_ratio` (no `auto`), `quality`, `nsfw_checker` |
| Qwen i2i | `image_url` (one string) | 10 MB | `strength` 0–1 (default 0.8); no aspect or size field; `nsfw_checker`, `enable_safety_checker` |
| Grok i2i | `image_urls[]` | 1–5 images, 10 MB | no aspect or resolution field; `nsfw_checker` |
| Nano Banana 2 | `image_input[]` | up to 10 images, 30 MB | `aspect_ratio` (`auto`), `resolution`; always filtered |

- **Image fields want a URL** after upload, not the file itself.
- **The upload endpoint:**
  - `POST https://kieai.redpandaai.co/api/file-base64-upload` with `{ base64Data, uploadPath, fileName }` and the same Bearer key.
  - Recommended up to 10 MB; `file-stream-upload` handles bigger files.
  - The answer's `data.downloadUrl` is the URL to send.
  - Errors come back as HTTP 200 with a non-200 `code`, so check `code`.
  - The OpenAPI servers block says api.kie.ai, but the examples use redpandaai. Use redpandaai, overridable by an env setting like `KIE_API_BASE`.
- **Approximate prices:** Flux-2 Pro i2i 5 / 7 credits (1K / 2K), Qwen i2i and Grok i2i 4, Nano Banana 2 8 / 12 / 18. The engine already records real costs per model.

## Children
- **P9-05a — engine and server:** the upload, picture models, routing, Variation rules and the engine on bot messages.
- **P9-05b — the app:** the Strength chips and note, the Variation button, and the "Model for pictures" setting with the upload note.
