# P9-04 — ComfyUI style presets (Container: a–c)

- **Unit Type:** Container (not implemented directly)
- **Phase:** 9
- **State:** PLANNED
- **Effort:** L in total: a M, b M, c S–M
- **Depends on:** P2-20b, P3-24 – P3-36 (the ComfyUI engine, advanced settings, custom workflows, img2img, Anima)
- **Requirement Source:** "one workflow first, presets later" (P3-34, 2026-10-19), picked up from the follow-up list. Design agreed with the owner on 2026-10-20:
  - **A preset is a named style**, e.g. "Anime", "Photoreal" or "Watercolor". It is either a **built-in setup** or **the host's own ComfyUI workflows**.
    - A built-in setup holds the model and its parts, the family, sampler, scheduler, steps, CFG, negative, and an optional **prompt prefix**.
    - Own workflows means the generate workflow, plus the optional upscale and image-to-image ones.
  - **People pick a style** in the /imagine panel, from a **Style** row next to Shape and Quality. The host marks one style as the default.
  - **Variations and Upscale** of an image run with **the style it was made with**, even if the default has changed since.

## What's shared and what's per style
- **Shared (as today):** the address, on/off, VRAM tier, the hires fix and its upscale model, Upscale mode and tiles, the face detailer and its passes, and the Variations loops and strengths.
- **Per style:**
  - `name`;
  - `mode`, built-in or custom;
  - `kind` (checkpoint / split), `model`, `family`, `clip1`, `clip2`, `vae`;
  - `sampler`, `scheduler`, `steps`, `cfgScale`, `negative`;
  - `promptPrefix` (new; built-in only, e.g. "anime screencap, ");
  - `workflow`, `upscaleWorkflow`, `img2imgWorkflow` (custom only).

## Children (one PR each, in order)
| Unit | What | Working set |
|---|---|---|
| P9-04a | Engine and server. The ComfyUI config gains `presets: [{ id, … }]` and `defaultPreset`; the existing single setup becomes the first preset, "Default", on first read (no data loss). The `imagine` op takes `preset` (unknown → refused, BAD_OPTION); the job stores it (migration v28 `imagine_jobs.preset`), and Variations, Upscale and Retry reuse it. A deleted preset falls back to the default, with a note. GET /spaces `imagine` lists the styles (`id`, `name`) and the default. The prompt prefix is added before the person's prompt (safety words still apply). The admin API validates each preset as today's single setup is (custom workflows checked on save). | engines/comfyui.js, imagine/index.js, runner, migrations, admin routes |
| P9-04b | Settings: Image generation › ComfyUI gets a **Styles** list with add, duplicate, rename, delete (not the last one) and make default. Editing a style shows today's model, Advanced and custom-workflow fields for that style; shared settings stay where they are. | ComfyPage.jsx, ImagineSettings.jsx, a StylesEditor component |
| P9-04c | The /imagine panel gets a **Style** chip row when the chosen engine is ComfyUI and there are 2+ styles; the default is preselected and remembered per person (local). The bot's message says the style ("🎨 sandy imagined (Anime): …"), and Again / Variations / Upscale keep it. | ImaginePanel.jsx, Composer, runner text, ImagineAgain |

## Decisions to keep
- **kie.ai has no styles.** Its row is hidden when kie.ai is the chosen engine.
- **A server's /imagine switch and limits are unchanged.** Styles aren't per server.
