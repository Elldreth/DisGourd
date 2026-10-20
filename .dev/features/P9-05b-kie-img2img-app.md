# P9-05b — kie.ai image-to-image: the app

- **Unit Type:** Implementation (child of P9-05)
- **Phase:** 9
- **State:** REVIEW
- **Starting baseline:** main at cf33943 (#188 merged)
- **Effort:** S–M
- **Depends on:** P9-05a

## Scope
- **The /imagine panel:**
  - "Start from a picture" shows when the chosen engine can do pictures (GET /spaces `pictures`).
  - The Strength chips show only when that engine has strength. Otherwise this note shows: "The picture guides the image; your prompt says what to change."
  - Switching the engine updates both.
- **Variation buttons (`ImagineAgain`):**
  - A kie.ai image (`imagineEngine: 'kie'`) whose model has no strength gets one **🎲 Variation** button, which sends `vary: 'once'`.
  - Other images keep Subtle and Strong, as today.
  - Upscale shows only when ComfyUI is on, as today.
  - "varied: …" messages (no strength) are recognized.
- **Settings › kie.ai:**
  - A **Model for pictures** picker, shown when the main model is Z-Image or custom.
  - A line under the model saying which picture model it uses, e.g. "Pictures use Flux-2 Pro image-to-image".
  - The upload note: "For pictures, DisGourd uploads the one picture to kie.ai's file storage for that job; kie.ai deletes it after 24 hours."

## As built
- **`ImaginePanel.jsx`:**
  - `imagineState` passes `pictures` from GET /spaces. A server from before P9-05a gives ComfyUI's when `canVary`.
  - `pictureEngineFor(imagine, engine)` follows the server's rule: the chosen engine, else ComfyUI.
  - The picture row shows when some engine can take the picture.
  - Strength chips show only when that engine has strength; otherwise the note does.
  - "Pictures use ComfyUI." appears when the chosen engine can't take pictures. A strength is still sent; the server ignores it there.
- **`ImagineAgain.jsx`:**
  - Takes `pictures` (in place of `canVary`) and runs a Variation on `pictures[m.imagineEngine] || pictures.comfyui`.
  - With a strength: Subtle and Strong. Without one: **🎲 Variation** (`vary: 'once'`). With neither: the older "Variations" new take.
  - The varied pattern now accepts any bracket, or none.
  - `MessageList`, `ChatPanel` and `ThreadPanel` pass `imaginePictures`.
- **`useChannelMessages`:** the `updated` action keeps `imagineEngine` from the bot's update frame, so a just-finished kie.ai image gets the right button without a reload.
- **Settings:**
  - `pictureModel` is in the kie.ai draft and the save body.
  - `KiePage` shows **Model for pictures** (with "None (pictures use ComfyUI, if it's on)") when the model has no picture version.
  - A note says which picture model is used, whether it has a strength, and the upload and 24-hour deletion.
- **Older test changed:** "varied (wild): x" is now a Variation, since the brackets can hold a style name (P9-04c).

## Acceptance criteria
- [x] Web:
  - The panel's picture row and Strength chips for ComfyUI, for kie.ai with strength and without, and after switching engines.
  - The single Variation button sends `once`.
  - Settings: when the picker shows, saving `pictureModel`, and the note.
- [x] All suites pass; `vite build` is clean.
- [x] Sandbox: start from a picture with kie.ai, then make a Variation of the result. This spends a few real credits, so the owner OKs it first.

## Evidence (2026-10-20)
| Acceptance criterion | Evidence |
|---|---|
| Web | `Composer.imagine.test.jsx` (+1): kie.ai without strength → no Strength chips, the note, sent with `strength: 'medium'`. Both on, kie.ai with strength → Strength chips, no "Pictures use". kie.ai can't take pictures → "Pictures use ComfyUI." with Strength. No engine → no picture option.<br>`ImagineAgain.test.jsx` (+1): kie.ai images (including "varied: …") get one "🎲 Variation" that sends `{ from: 12, vary: 'once' }`; a ComfyUI image keeps Subtle; kie.ai with strength → Subtle; only ComfyUI can vary → Strong; nothing can → the older Variations. The pattern accepts "(wild)" and none, not "varied x".<br>`useChannelMessages.test.js` (+1): the update keeps `imagineEngine`, and a later edit doesn't drop it.<br>`ImagineAdmin.test.jsx` (+1): Z-Image → the picker (None, Flux-2 Pro) and "kie.ai won't take pictures with this model."; picking Flux shows the full note, and Save sends `pictureModel`; Flux as the main model → no picker. The kie.ai save body includes `pictureModel: null`. |
| All suites | Web 102 files, 801. `vite build` clean. Server unchanged since #188 (447) |
| Sandbox (:3005; OK'd ~8 credits) | **Free checks:**<br>• Buttons: the five gourd images show Subtle/Strong on the ComfyUI ones and "🎲 Variation" on the two Grok ones. Three older kie.ai images (Seedream, Grok) also get "🎲 Variation".<br>• Panel, replying to the Grok image: kie.ai → "The picture guides the image; your prompt says what to change." with no chips; ComfyUI → Subtle/Medium/Strong.<br>• Settings › kie.ai: Grok → the note naming Grok Imagine image-to-image, one button, upload and 24 h. Switching to Z-Image (then Reset) → the picker with None plus the five models.<br>**Paid:** replying to the Photoreal gourd, kie.ai, "/imagine the same gourd on a snowy windowsill in winter" → job 98 `kie img2img grok-imagine/image-to-image`, 4 credits, the gourd on a snowy sill. Its "🎲 Variation" appeared without a reload; pressing it → job 99 `vary`, 4 credits, "🎲 sandy varied: …". Balance 7,908.4 → 7,900.4 |
