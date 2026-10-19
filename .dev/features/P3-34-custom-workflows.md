# P3-34 — Custom ComfyUI workflows with placeholders

- **Unit Type:** Implementation
- **Phase:** 3
- **State:** REVIEW
- **Effort:** M
- **Depends on:** P3-24 – P3-33 (the ComfyUI engine and Settings). Branched from P3-33 (#143).
- **Requirement Source:** the user, 2026-10-18: "offer the ability to load a custom workflow that the end user provides … there are people who have built their own nodes for some of these tasks". Agreed shape (2026-10-18): the host pastes an API-format workflow with placeholders, DisGourd fills them per request, every node is checked before it's switched on, and the built-in hires fix / detailer / Advanced don't apply while it's in use.

## Scope
- **Settings → Image generation → ComfyUI**, "Workflow: Built-in / My own":
  - "My own" shows a box to paste, or a file to load, the workflow JSON from ComfyUI's **Export (API)**.
  - Optionally, a second box for an **Upscale workflow**. Without one, the Upscale button keeps using the built-in upscale.
- **Placeholders** in node inputs, filled per request:

  | Placeholder | Filled with |
  |---|---|
  | `{{prompt}}` (required) | the prompt |
  | `{{negative}}` | the negative: the host's Advanced negative or the built-in one, plus the safety words outside 18+ (not for Flux / Z-Image, as today) |
  | `{{seed}}` | a random seed per request, so Variations differ |
  | `{{width}}`, `{{height}}` | from Shape and Quality within the VRAM tier (the family's sizes; family from Model type) |
  | `{{steps}}` | by Quality (the Advanced steps or the family's defaults) |
  | `{{quality}}` | draft / standard / high, for workflows that branch on it |

  For the upscale workflow:

  | Placeholder | Filled with |
  |---|---|
  | `{{image}}` | the uploaded source, for LoadImage |
  | `{{scale}}` | the 2× factor capped at 4096 px |
  | `{{prompt}}`, `{{negative}}`, `{{seed}}` | as above |

  - **Number fields:** when an input's whole value is a placeholder, it becomes the right type (a number for seed / width / height / steps / scale).
  - **Text fields:** a placeholder inside a longer string is replaced in place (e.g. `"masterpiece, {{prompt}}"`).
- **Output:** every image from the workflow's output nodes (SaveImage / PreviewImage, or any node reporting images in /history) comes back, up to 4, posted together.
- **Checks on Save:**
  - It must be JSON in API format: an object of nodes with `class_type`. The UI-format export (with a `nodes` array) is refused with "Use Export (API) in ComfyUI".
  - The generate workflow must contain `{{prompt}}`, the upscale one `{{image}}`.
  - Unknown placeholders are listed as an error.
  - Every `class_type` must exist on that ComfyUI (`/object_info`); missing ones are listed by name.
  - Size limit 256 KB.
  - Once saved, the "Test image" button runs it.
- **At generate time:** a node missing later → a plain failure, "Your custom workflow needs X, which ComfyUI doesn't have", with Retry. There's no fallback, because DisGourd can't know what the host's node did.
- **The prompt check** (always-refused prompts) still runs first. The daily limit, budget and permissions are unchanged.
- **Built-in options while "My own" is on:** the hires fix, face detailer, Advanced and the tiled settings are greyed out with "Your workflow decides this". Model type / VRAM tier still size `{{width}}` / `{{height}}`.
- **Security:** site admins only, as for all of Image generation. The workflow is stored in the instance settings (not shown to members) and only queued on the host's own ComfyUI. DisGourd never runs anything from it.

## Decision (user, 2026-10-18)
- One custom workflow, plus the optional upscale one. Named presets people choose in chat can come later.

## Acceptance criteria
- [x] Engine: placeholders filled (types for whole values, in place inside strings), the seed different per request; images collected from output nodes (several posted); the upscale workflow gets the uploaded image name and scale; a missing node at run time gives the plain error.
- [x] Settings API: refused for UI-format JSON, invalid JSON, no `{{prompt}}` / `{{image}}`, unknown placeholders, missing nodes (listed), over 256 KB; accepted otherwise; the test image runs it.
- [x] Web: Built-in / My own switch, paste / load, the errors shown, built-in options greyed while My own is on.
- [x] All suites pass; `vite build` is clean.
- [x] Live: a workflow exported from the user's ComfyUI with placeholders makes an image in chat; Variations differ; an upscale workflow (if provided) works.

## Implementation notes
- **Nodes are checked on save only when the workflow changed,** so a ComfyUI that's briefly offline doesn't block unrelated saves. The check asks `/object_info/<node>` for each distinct node type, without the cache.
- **"My own" doesn't need a model picked**; Model type and VRAM tier still size `{{width}}` / `{{height}}`. With My own, Advanced's Steps and Negative feed `{{steps}}` / `{{negative}}`, and the Settings note says so; the hires fix is disabled; the Upscale button's built-in options are disabled while an upscale workflow is set.
- **A node gone at run time** (ComfyUI's `missing_node_type`) reads "Your custom workflow needs X, which ComfyUI doesn't have"; for the built-in workflows, "ComfyUI doesn't have the node X".
- **Missing-node fallbacks (P3-33) only apply to the built-in workflows.**

## Evidence (2026-10-18)
| Acceptance criterion | Evidence |
|---|---|
| Engine | `imagine-comfyui.test.js` (32, 5 new). Checks: invalid JSON, the UI-format file ("use Export (API)"), nodes without class_type, no {{prompt}}, unknown {{lora}} (lists the allowed ones), an upscale workflow without {{image}}, generate-only placeholders in an upscale workflow, over 256 KB; class types listed. Fill: width / height numbers equal to `sizeFor`, "masterpiece, a gourd", the negative with safety words, the host's cfg / sampler kept, steps 44 from Advanced, a new seed each build, the stored workflow untouched, `{{ quality }}` with spaces and `{{scale}}` 1.5. End to end: 2 images (Save + Preview), the nodes sent equal the host's (no hires / detailer added); the upscale workflow gets the uploaded name and scale_by 2 (1200×800); without one, the built-in upscale (node 22); GoneNode → "Your custom workflow needs GoneNode, which ComfyUI doesn't have". Config: mode values, My own needs a workflow, label prefixes, no model needed, round-trips as pretty JSON. Route: unknown nodes listed ("MyCustomSampler, OtherNode"), UI format refused, an upscale workflow with "Nope" refused, a valid one saved; the test image runs it |
| Web | `ImagineAdmin.test.jsx` (14, 2 new): My own shows the boxes; pasting, and Load file into the upscale box; placeholder help; the hires fix disabled; "Your upscale workflow is used instead of these."; Save sends mode / workflow / upscale; the server's refusal is shown; a saved workflow is back in the box |
| Suites | Server: 352 tests. Web: 74 files, 624 tests. `vite build` clean |
| Live (user's ComfyUI) | Sandbox restarted on this branch. Saving with "MyCustomSampler" → 400 "Workflow: your ComfyUI doesn’t have this node: MyCustomSampler"; the UI-format file → 400 "…use Export (API) instead". A 7-node SDXL workflow (Elldreths_tbn, euler_ancestral, CFG 5.5, "watercolor painting, soft paper texture, {{prompt}}", PreviewImage only) saved. In chat, "/imagine a lighthouse on a cliff at sunset" → msg 906, 1024², visibly watercolor on paper; Variations → msg 907, a different image (new seed). The sandbox's ComfyUI settings were then put back to Built-in with no workflow (its model, FLUX_Breasts, untouched) |
