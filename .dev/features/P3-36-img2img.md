# P3-36 — img2img: Subtle / Strong Variations, and starting from your own image (Container: a–b)

- **Unit Type:** Container
- **Phase:** 3
- **State:** PLANNED (a ACTIVE)
- **Depends on:** P3-23 (Variations), P3-24 – P3-34 (ComfyUI engine, upscale, detailer, custom workflows)
- **Requirement Source:** the user, 2026-10-19: "incorporate img2img as an option and … the 'variations' option to use the image that you select 'variations' with as the source image for img2img … subtle variations and strong variations." Also: "it doesn't look like face detailer is doing anything to high quality images". Decisions (user, 2026-10-19):
  - Variations becomes two buttons, **Subtle variation** (img2img from that image, repaint about 0.35) and **Strong variation** (about 0.6).
  - **Starting from your own image** in the /imagine panel: attach a picture, or use the one you're replying to, with a strength choice.
  - **ComfyUI first.** kie.ai keeps "new take" Variations for now.
  - **The face detailer fix goes in the same work** (36a).

## Detailer investigation (2026-10-19)
- The sandbox's High images all ran FaceDetailer (nodes 40 / 41, the output taken from 41) with no errors. Settings: detector `bbox/face_yolov8n_v2.pt`, 3 passes, strength 0.3.
- All three face detectors find the face in the user's latest images at 0.5 / 0.3 / 0.2 confidence (detection-only run).
- A before/after preview of the user's exact High setup shows the detailer changes the face (a mean change of 6.8 over an 876×840 region), but only slightly. On a 1280×1856 hires image the face crop (3× the face box) is about 900 px, and the crop's `max_size` is 1024, so it's barely enlarged before repainting. Detailers mainly help small faces; to help big ones too, allow bigger crops on High and crop tighter.

## Children
| Unit | What |
|---|---|
| P3-36a | Engine img2img (LoadImage → scale → VAEEncode → KSampler denoise); "Subtle variation" / "Strong variation" buttons on ComfyUI-capable images (any engine's image, run on ComfyUI); a new job kind `vary` with stored strength (migration v19), Retry, limit / permissions as Variations; the detailer's max crop by VRAM tier (1024 / 1536 / 2048) and crop factor 2 |
| P3-36b | /imagine panel "Start from an image": attach (uploaded first) or the replied-to image, strength Subtle / Medium / Strong, shape following the picture; an optional "Image-to-image workflow" for custom-workflow hosts ({{image}}, {{denoise}}) |
