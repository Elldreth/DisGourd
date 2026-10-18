# P3-28 — ComfyUI hires fix

- **Unit Type:** Implementation
- **Phase:** 3
- **State:** REVIEW
- **Effort:** S–M
- **Depends on:** P3-24 (#135; same engine file). Branched from it; merge after it.
- **Requirement Source:** the user, 2026-10-18: "add in a hires fix to the comfyui workflow". Decisions (user, 2026-10-18):
  - **High quality only**, with a Settings switch to turn it off (on by default).
  - Enlarge with an **upscale model** (default 4x-UltraSharp, choosable), then a light repaint (about 0.4).
  - Upscale buttons on images are a separate conversation, after this.

## Scope
- **High quality with the fix on and an upscale model set:**
  1. The first pass is made at the Standard size, with High's steps.
  2. UpscaleModelLoader → ImageUpscaleWithModel → ImageScale (lanczos) to the final size.
  3. VAEEncode, then a second KSampler with the same model, prompt, guidance and seed, Standard's steps, at denoise 0.4.
  4. VAEDecode → PreviewImage.
- **Final size:** about 1.5× each side, within a per-tier budget (low 1.6, medium 2.4, high 3.6 megapixels), in multiples of 64. For example, 1024² becomes 1536² on medium/high, and 1280² on low.
- **Engines:** works with checkpoints and split models (Flux, Z-Image). It doesn't apply to kie.ai.
- **Settings:** a "Hires fix for High quality" checkbox, and an "Upscale model" dropdown from this ComfyUI's `UpscaleModelLoader` list. The default is picked by name: UltraSharp, then Remacri, then a general 4×, then 2×. With no upscale models, High is made without the fix, and Settings says so.
- **Any host:** nothing assumes this PC's files. A missing upscale model gets a plain error ("The upscale model "x" isn't in ComfyUI any more").

## Acceptance criteria
- [x] Server: the workflow at High has the Standard-size first pass, nodes 20–25 wired as above, and the final size; it's not applied at Standard, when switched off, or without an upscale model; split Flux wiring is checked; every tier and shape stays in budget. The listing returns `upscalers` and `suggested.upscaler` (not the anime one listed first), or null with none. End to end through the mock at 1536². A missing upscale model is explained. The config round-trips, and `hires` defaults to on.
- [x] Web: the switch starts on; after Test connection the suggested upscale model is chosen; a different choice and switching it off are both saved.
- [x] All suites pass; `vite build` is clean.
- [x] Live on the user's ComfyUI: a High image with the fix from Flux (split) and from an SDXL checkpoint.

## Evidence (2026-10-18)
| Acceptance criterion | Evidence |
|---|---|
| Server | `imagine-comfyui.test.js` (17, 2 new + listing): an SDXL High request at medium has latent 1024², final 1536², 20 UpscaleModelLoader `4x-UltraSharp.pth`, 21 → 22 ImageScale lanczos 1536², 23 VAEEncode (the checkpoint's VAE), 24 KSampler seed 7 / denoise 0.4 / 28 steps / latent ['23',0] (first pass 36 steps), and 9 → ['25',0]. Flux split: 24 uses ['11',0] and FluxGuidance ['10',0]; 23 uses VAE ['13',0]. Not applied for Standard, `hires: false` or no upscaler. All tiers × shapes are multiples of 64 within HIRES_MP × 1.1. The mock run returns 1536×1536 with node 20 set; `gone.pth` gives 'The upscale model "gone.pth" isn't in ComfyUI any more' |
| Web | `ImagineAdmin.test.jsx` (8, 1 new): checkbox on; "Upscale model" = `4x-UltraSharp.pth` after the test; picking AnimeSharp saves `{ hires: true, upscaler: '4x-AnimeSharp.pth' }`; unchecking hides the picker and saves `hires: false` |
| Suites | Server: 328 tests. Web: 74 files, 614 tests. `vite build` clean |
| Live (user's ComfyUI) | 12 upscale models listed, suggested `4x-UltraSharp.pth`. High, square, high tier: `flux1-dev-fp8` (split) gave 1536×1536 in 43.4 s; `Illustrious-XL-v2.0` (checkpoint) gave 1536×1536 in 17.9 s. Both are clean and detailed, with no seams or artifacts |

## Discovered Work
- Flux with the fix takes about 2.4× as long as without (43 s vs 18 s). That's fine on a 32 GB card; slower cards may want it off, which the switch allows.
- Upscale buttons on finished images: to discuss with the user next.
