// The ComfyUI engine (P2-20b): a local ComfyUI server the site admin points
// at. DisGourd builds an API-format workflow for the chosen checkpoint's
// family (SD 1.5, SDXL, Flux or Z-Image Turbo), queues it with POST /prompt, waits on
// /history and fetches the image with /view. Images go through PreviewImage
// (ComfyUI's temp folder), so nothing piles up in its output folder.
//
// The address is set by site admins only, so it may be on the LAN and is
// called directly (not through safeFetch, which refuses private addresses).
// ComfyUI has no content filter: outside 18+ channels SD 1.5 / SDXL get a
// negative-prompt nudge, which is not a filter (Flux at CFG 1 ignores it).
//
// A model is either a single checkpoint (CheckpointLoaderSimple) or, since
// P3-24, separate parts: a diffusion model (UNETLoader) plus its text
// encoder(s) and VAE. Nothing here assumes particular file names: the lists
// come from the host's own ComfyUI, and the parts suggested for a split model
// are guesses by name that the host can change.
const crypto = require('crypto');

const FAMILIES = {
  sd15: { name: 'SD 1.5', mp: { draft: 0.26, standard: 0.33, high: 0.45 }, steps: { draft: 16, standard: 26, high: 34 }, cfg: 7, sampler: 'dpmpp_2m', scheduler: 'karras' },
  sdxl: { name: 'SDXL', mp: { draft: 0.8, standard: 1.0, high: 1.15 }, steps: { draft: 18, standard: 28, high: 36 }, cfg: 6, sampler: 'dpmpp_2m', scheduler: 'karras' },
  flux: { name: 'Flux', mp: { draft: 0.6, standard: 1.0, high: 1.6 }, steps: { draft: 12, standard: 20, high: 28 }, cfg: 1, guidance: 3.5, sampler: 'euler', scheduler: 'simple' },
  // Z-Image Turbo (P3-24): separate parts only; Qwen 3 4B text encoder (lumina2).
  zimage: { name: 'Z-Image Turbo', splitOnly: true, mp: { draft: 0.8, standard: 1.0, high: 1.6 }, steps: { draft: 6, standard: 8, high: 10 }, cfg: 1, shift: 3, sampler: 'res_multistep', scheduler: 'simple' },
  // Anima (P3-35): separate parts only; Qwen-3 0.6B text encoder
  // (CLIPLoader type stable_diffusion) and the Qwen-Image VAE. From Comfy's
  // official templates: EmptyLatentImage, 30 steps, CFG 4, er_sde / simple.
  anima: { name: 'Anima', splitOnly: true, mp: { draft: 0.8, standard: 1.0, high: 1.6 }, steps: { draft: 20, standard: 30, high: 40 }, cfg: 4, sampler: 'er_sde', scheduler: 'simple', clipType: 'stable_diffusion', negative: 'worst quality, low quality, score_1, score_2, score_3, blurry, jpeg artifacts, sepia' },
};
// Families a split model (UNETLoader) can be.
const SPLIT_FAMILIES = ['flux', 'zimage', 'anima'];
// Diffusion models that make video, not images: left out of the list.
const VIDEO = /hunyuan.?video|(^|[\\/_\- ])ltx|minimax|(^|[\\/_\- ])wan[\d_.\- ]|mochi|cosmos|cogvideo|svd|animatediff/i;
// The most pixels each VRAM tier is asked for (megapixels).
const TIERS = { low: 1.0, medium: 1.5, high: 2.4 };
// The hires fix (P3-28), for High quality only: the image is made at the
// Standard size, enlarged with an upscale model to about 1.5× (at most this
// many megapixels for the tier), then repainted lightly at that size.
const HIRES_MP = { low: 1.6, medium: 2.4, high: 3.6 };
const HIRES_SCALE = 1.5;
const HIRES_DENOISE = 0.4;
// The Upscale button (P3-29): 'model' (the upscale model alone; ComfyUI tiles
// it internally, so big images are fine) or 'tiled' (Ultimate SD Upscale:
// repaints tile by tile for added detail; needs that custom node).
const UPSCALE_MODES = ['model', 'tiled'];
const TILE = { denoise: 0.3, size: 1024 };
// The face detailer (P3-31, Impact Pack's FaceDetailer): on Standard and High.
const DETAILER_DENOISE = 0.4;
// The largest the face crop is enlarged to before repainting, by VRAM tier
// (P3-36a: 1024 left big faces barely enlarged, so the detailer did little).
const DETAILER_MAX = { low: 1024, medium: 1536, high: 2048 };
const DETAILER_CROP = 2;
// Variations are an img2img loopback (P3-36a): each loop repaints the whole
// image (a new seed each time), runs the face detailer, and feeds the next.
const DEFAULT_LOOPS = 2;
const MAX_LOOPS = 4;
const DETAILER_QUALITIES = ['standard', 'high'];
// Passes (P3-33): the face detailer repaints each face up to 5 times
// (FaceDetailer's own `cycle`); tiled repaint runs up to 3 passes, the extra
// ones with Ultimate SD Upscale (No Upscale) at the full size.
const MAX_DETAILER_PASSES = 5;
const MAX_TILE_PASSES = 3;
// The custom nodes each optional feature needs, by ComfyUI node name.
const NEEDS = {
  detailer: ['FaceDetailer', 'UltralyticsDetectorProvider'],
  tiled: ['UltimateSDUpscale'],
  tilePasses: ['UltimateSDUpscaleNoUpscale'],
};
const RATIOS = { square: [1, 1], portrait: [2, 3], landscape: [3, 2], wide: [16, 9] };
const NEGATIVE = 'lowres, worst quality, low quality, blurry, jpeg artifacts, watermark, signature, text';
const SAFE_NEGATIVE = 'nsfw, nude, nudity';
const SAVE_NODE = '9';

// A split model's likely family, or null when its name doesn't say.
function guessSplitFamily(name) {
  const n = String(name || '').toLowerCase();
  if (/z[_\- ]?image|zturbo/.test(n)) return 'zimage';
  if (/anima/.test(n)) return 'anima';
  if (/flux/.test(n)) return 'flux';
  return null;
}

// The text encoders and VAE a split model probably wants, picked by name from
// what this ComfyUI has (null where nothing fits).
function suggestParts(family, clips = [], vaes = []) {
  const find = (list, ...tests) => {
    for (const re of tests) {
      const hit = list.find((x) => re.test(x));
      if (hit) return hit;
    }
    return null;
  };
  const ae = (folder) => find(vaes, new RegExp(`(?:${folder})[^\\\\/]*[\\\\/][^\\\\/]*\\bae\\.(sft|safetensors)$`, 'i'), /(^|[\\/])ae\.(sft|safetensors)$/i, /\bae\b|flux.*vae/i);
  if (family === 'flux') {
    return {
      clip1: find(clips, /(^|[\\/])clip_l\.safetensors$/i, /clip_l/i),
      clip2: find(clips, /t5xxl/i, /t5.*xxl/i),
      vae: ae('flux'),
    };
  }
  if (family === 'zimage') {
    return { clip1: find(clips, /qwen_?3_?4b/i, /qwen.*4b/i), clip2: null, vae: ae('z[_\\- ]?image|zturbo') };
  }
  if (family === 'anima') {
    return {
      clip1: find(clips, /anima[\\/].*qwen_?3_?0_?6b/i, /qwen_?3_?0_?6b/i, /qwen.*0\.?6b/i),
      clip2: null,
      vae: find(vaes, /anima[\\/].*qwen_image_vae/i, /qwen_image_vae/i, /qwen.*image.*vae/i),
    };
  }
  return { clip1: null, clip2: null, vae: null };
}

// A general-purpose upscale model, by name, from this ComfyUI's list (or null).
function suggestUpscaler(list = []) {
  for (const re of [/ultrasharp/i, /remacri/i, /realesrgan_x4plus(?!_anime)/i, /4x/i, /2x|x2/i]) {
    const hit = list.find((x) => re.test(x));
    if (hit) return hit;
  }
  return list[0] || null;
}

// A face detector, by name, from this ComfyUI's list (or null).
function suggestDetector(list = []) {
  for (const re of [/face_yolov8m/i, /face_yolov8s/i, /face_yolov8/i, /face/i]) {
    const hit = list.find((x) => re.test(x));
    if (hit) return hit;
  }
  return null;
}

// A checkpoint's likely family from its folder and name.
function guessFamily(name) {
  const n = String(name || '').toLowerCase();
  if (/flux/.test(n)) return 'flux';
  if (/(^|[\\/_\- ])sd ?1(\.?5)?([\\/_\- ]|$)|sd15|v1-5|1\.5/.test(n)) return 'sd15';
  return 'sdxl'; // xl, illustrious, pony, noob… and the default
}

// Width × height for a family, quality, shape and tier: about the target
// pixel count (capped by the tier), in multiples of 64.
function sizeFor(family, quality, shape, tier) {
  const f = FAMILIES[family] || FAMILIES.sdxl;
  const mp = Math.min(f.mp[quality] || f.mp.standard, TIERS[tier] || TIERS.medium);
  const [rw, rh] = RATIOS[shape] || RATIOS.square;
  const px = mp * 1e6;
  let w = Math.sqrt((px * rw) / rh);
  let h = (w * rh) / rw;
  const r64 = (v) => Math.max(256, Math.round(v / 64) * 64);
  w = r64(w);
  h = r64(h);
  // The tiers are approximate: rounding may go up to 10% over, not more.
  const cap = (TIERS[tier] || TIERS.medium) * 1e6 * 1.1;
  while (w * h > cap) {
    if (w >= h) w -= 64;
    else h -= 64;
  }
  return { width: w, height: h };
}

// The hires fix's final size for a base size and tier: up to 1.5× each side,
// within the tier's hires budget, in multiples of 64.
function hiresSize({ width, height }, tier) {
  const budget = (HIRES_MP[tier] || HIRES_MP.medium) * 1e6;
  const scale = Math.min(HIRES_SCALE, Math.sqrt(budget / (width * height)));
  return { width: Math.round((width * scale) / 64) * 64, height: Math.round((height * scale) / 64) * 64 };
}
// Whether a request gets the hires fix: High quality, switched on, with an upscale model.
const hiresFor = (request, cfg) => request.quality === 'high' && cfg.hires !== false && !!cfg.upscaler;

// The host's advanced settings (P3-31), each falling back to the family's
// tuned default when blank.
const stepsFor = (f, cfg, quality) => cfg.steps?.[quality] || f.steps[quality] || f.steps.standard;
const samplingFor = (f, cfg) => ({ cfg: cfg.cfgScale ?? f.cfg, sampler_name: cfg.sampler || f.sampler, scheduler: cfg.scheduler || f.scheduler });
// The negative prompt: the host's own replaces the built-in quality words;
// outside 18+ the safety words are added for SD 1.5 / SDXL. Flux and Z-Image
// (CFG 1) get one only if the host set it.
function negativeFor(family, cfg, permissive) {
  const own = typeof cfg.negative === 'string' && cfg.negative.trim() ? cfg.negative.trim() : null;
  if (family === 'flux' || family === 'zimage') return own || '';
  // Anima (CFG 4) uses negatives; its own built-in one, plus the safety words.
  return [own || FAMILIES[family]?.negative || NEGATIVE, permissive ? null : SAFE_NEGATIVE].filter(Boolean).join(', ');
}
// Whether a request gets the face detailer: switched on, a detector known, and
// Standard or High quality.
const detailerFor = (request, cfg) => !!cfg.detailer && !!cfg.detector && DETAILER_QUALITIES.includes(request.quality);

// The API-format workflow for one request.
function buildWorkflow(request, cfg, { permissive = false, seed = crypto.randomInt(0, 2 ** 32) } = {}) {
  const split = cfg.kind === 'unet';
  const family = FAMILIES[cfg.family] && (split || !FAMILIES[cfg.family].splitOnly) ? cfg.family : 'sdxl';
  const f = FAMILIES[family];
  // img2img (P3-36a): a variation starts from an image (node 1, uploaded).
  const init = request.init && request.initName ? request.init : null;
  const wantsHires = hiresFor(request, cfg);
  // With the hires fix, the first pass is made at the Standard size. A
  // variation instead works at the final size (its loops do the refining).
  const hires = wantsHires && !init;
  const small = sizeFor(family, wantsHires ? 'standard' : request.quality, request.shape, cfg.tier);
  const { width, height } = wantsHires ? hiresSize(small, cfg.tier) : small;
  const base = init ? { width, height } : small;
  const negative = negativeFor(family, cfg, permissive);
  const sampling = samplingFor(f, cfg);
  // Where the model, text encoder and VAE come from: one checkpoint (node 4),
  // or separate loaders (11 diffusion model, 12 text encoder(s), 13 VAE).
  const loaders = split
    ? {
        11: { class_type: 'UNETLoader', inputs: { unet_name: cfg.model, weight_dtype: 'default' } },
        12: family === 'flux'
          ? { class_type: 'DualCLIPLoader', inputs: { clip_name1: cfg.clip1, clip_name2: cfg.clip2, type: 'flux' } }
          : { class_type: 'CLIPLoader', inputs: { clip_name: cfg.clip1, type: f.clipType || 'lumina2' } },
        13: { class_type: 'VAELoader', inputs: { vae_name: cfg.vae } },
      }
    : { 4: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: cfg.model } } };
  const model = split ? ['11', 0] : ['4', 0];
  const clip = split ? ['12', 0] : ['4', 1];
  const vae = split ? ['13', 0] : ['4', 2];
  const wf = {
    ...loaders,
    5: init
      ? { class_type: 'VAEEncode', inputs: { pixels: ['2', 0], vae } }
      : { class_type: family === 'flux' || family === 'zimage' ? 'EmptySD3LatentImage' : 'EmptyLatentImage', inputs: { width: base.width, height: base.height, batch_size: 1 } },
    6: { class_type: 'CLIPTextEncode', inputs: { text: request.prompt, clip } },
    7: { class_type: 'CLIPTextEncode', inputs: { text: negative, clip } },
    3: {
      class_type: 'KSampler',
      inputs: {
        seed, steps: stepsFor(f, cfg, request.quality), ...sampling, denoise: init ? init.denoise : 1,
        model, positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0],
      },
    },
    8: { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae } },
    [SAVE_NODE]: { class_type: 'PreviewImage', inputs: { images: ['8', 0] } },
  };
  if (init) {
    wf[1] = { class_type: 'LoadImage', inputs: { image: request.initName } };
    wf[2] = { class_type: 'ImageScale', inputs: { image: ['1', 0], upscale_method: 'lanczos', width: base.width, height: base.height, crop: 'center' } };
  }
  if (family === 'zimage') {
    wf[14] = { class_type: 'ModelSamplingAuraFlow', inputs: { model, shift: f.shift } };
    wf[3].inputs.model = ['14', 0];
  }
  if (family === 'flux') {
    wf[10] = { class_type: 'FluxGuidance', inputs: { conditioning: ['6', 0], guidance: f.guidance } };
    wf[3].inputs.positive = ['10', 0];
  }
  if (hires) {
    // Enlarge the first image with the upscale model, size it exactly, then
    // repaint lightly with the same model and prompt.
    wf[20] = { class_type: 'UpscaleModelLoader', inputs: { model_name: cfg.upscaler } };
    wf[21] = { class_type: 'ImageUpscaleWithModel', inputs: { upscale_model: ['20', 0], image: ['8', 0] } };
    wf[22] = { class_type: 'ImageScale', inputs: { image: ['21', 0], upscale_method: 'lanczos', width, height, crop: 'disabled' } };
    wf[23] = { class_type: 'VAEEncode', inputs: { pixels: ['22', 0], vae } };
    wf[24] = {
      class_type: 'KSampler',
      inputs: { ...wf[3].inputs, seed, steps: stepsFor(f, cfg, 'standard'), denoise: HIRES_DENOISE, latent_image: ['23', 0] },
    };
    wf[25] = { class_type: 'VAEDecode', inputs: { samples: ['24', 0], vae } };
    wf[SAVE_NODE].inputs.images = ['25', 0];
  }
  const detailer = detailerFor(request, cfg);
  if (detailer) {
    // Find faces in the finished image and repaint each at a good size.
    const guide = family === 'sd15' ? 512 : 1024;
    const maxSize = family === 'sd15' ? 768 : DETAILER_MAX[cfg.tier] || DETAILER_MAX.medium;
    wf[40] = { class_type: 'UltralyticsDetectorProvider', inputs: { model_name: cfg.detector } };
    wf[41] = {
      class_type: 'FaceDetailer',
      inputs: {
        image: wf[SAVE_NODE].inputs.images, model: wf[3].inputs.model, clip, vae, positive: wf[3].inputs.positive, negative: ['7', 0],
        guide_size: guide, guide_size_for: true, max_size: maxSize, seed, steps: stepsFor(f, cfg, 'standard'), ...sampling,
        denoise: cfg.detailerDenoise ?? DETAILER_DENOISE, feather: 5, noise_mask: true, force_inpaint: true,
        bbox_threshold: 0.5, bbox_dilation: 10, bbox_crop_factor: DETAILER_CROP, sam_detection_hint: 'center-1', sam_dilation: 0, sam_threshold: 0.93,
        sam_bbox_expansion: 0, sam_mask_hint_threshold: 0.7, sam_mask_hint_use_negative: 'False', drop_size: 10,
        bbox_detector: ['40', 0], wildcard: '', cycle: Math.min(MAX_DETAILER_PASSES, Math.max(1, cfg.detailerPasses || 1)),
      },
    };
    wf[SAVE_NODE].inputs.images = ['41', 0];
  }
  // The loopback (P3-36a): loops 2…n start from the previous loop's image.
  const loops = init ? Math.min(MAX_LOOPS, Math.max(1, cfg.varyLoops || DEFAULT_LOOPS)) : 1;
  let last = wf[SAVE_NODE].inputs.images;
  for (let k = 1; k < loops; k++) {
    const b = 100 + k * 10;
    wf[b] = { class_type: 'VAEEncode', inputs: { pixels: last, vae } };
    wf[b + 1] = { class_type: 'KSampler', inputs: { ...wf[3].inputs, seed: seed + k, denoise: init.denoise, latent_image: [String(b), 0] } };
    wf[b + 2] = { class_type: 'VAEDecode', inputs: { samples: [String(b + 1), 0], vae } };
    last = [String(b + 2), 0];
    if (detailer) {
      wf[b + 3] = { class_type: 'FaceDetailer', inputs: { ...wf[41].inputs, image: last, seed: seed + k } };
      last = [String(b + 3), 0];
    }
  }
  wf[SAVE_NODE].inputs.images = last;
  return { workflow: wf, width, height, seed, hires, detailer, loops };
}

// The Upscale button's workflow (P3-29) for an image already uploaded to
// ComfyUI as `imageName`: request.upscale = { width, height, factor }.
function buildUpscaleWorkflow(request, cfg, imageName, { permissive = false, seed = crypto.randomInt(0, 2 ** 32) } = {}) {
  const { width: w0, height: h0, factor } = request.upscale;
  const width = Math.round((w0 * factor) / 8) * 8;
  const height = Math.round((h0 * factor) / 8) * 8;
  const load = { class_type: 'LoadImage', inputs: { image: imageName } };
  if (cfg.upscaleMode !== 'tiled') {
    return {
      width, height, seed,
      workflow: {
        1: load,
        20: { class_type: 'UpscaleModelLoader', inputs: { model_name: cfg.upscaler } },
        21: { class_type: 'ImageUpscaleWithModel', inputs: { upscale_model: ['20', 0], image: ['1', 0] } },
        22: { class_type: 'ImageScale', inputs: { image: ['21', 0], upscale_method: 'lanczos', width, height, crop: 'disabled' } },
        [SAVE_NODE]: { class_type: 'PreviewImage', inputs: { images: ['22', 0] } },
      },
    };
  }
  // Tiled: the configured model and the prompt, as for a Standard image, but
  // sampling happens inside Ultimate SD Upscale instead of a KSampler.
  const base = buildWorkflow({ ...request, quality: 'standard' }, { ...cfg, hires: false, detailer: false }, { permissive, seed });
  const wf = base.workflow;
  const s = wf[3].inputs;
  const vae = wf[8].inputs.vae;
  for (const k of ['3', '5', '8']) delete wf[k];
  const f = FAMILIES[cfg.kind === 'unet' || !FAMILIES[cfg.family]?.splitOnly ? cfg.family : 'sdxl'] || FAMILIES.sdxl;
  const tile = Math.min(2048, Math.max(512, Math.round((cfg.tileSize || TILE.size) / 64) * 64));
  wf[1] = load;
  wf[20] = { class_type: 'UpscaleModelLoader', inputs: { model_name: cfg.upscaler } };
  wf[30] = {
    class_type: 'UltimateSDUpscale',
    inputs: {
      image: ['1', 0], model: s.model, positive: s.positive, negative: s.negative, vae, upscale_model: ['20', 0],
      upscale_by: factor, seed, steps: stepsFor(f, cfg, 'standard'), cfg: s.cfg, sampler_name: s.sampler_name, scheduler: s.scheduler,
      denoise: cfg.tileDenoise ?? TILE.denoise, mode_type: 'Linear', tile_width: tile, tile_height: tile, mask_blur: 8, tile_padding: 32,
      seam_fix_mode: 'None', seam_fix_denoise: 1, seam_fix_width: 64, seam_fix_mask_blur: 8, seam_fix_padding: 16,
      force_uniform_tiles: true, tiled_decode: false, batch_size: 1,
    },
  };
  // Extra passes (P3-33) repaint the enlarged image again, tile by tile.
  const passes = Math.min(MAX_TILE_PASSES, Math.max(1, cfg.tilePasses || 1));
  let last = '30';
  for (let i = 1; i < passes; i++) {
    const id = String(30 + i);
    const { image, upscale_model: _m, upscale_by: _b, ...same } = wf[30].inputs;
    wf[id] = { class_type: 'UltimateSDUpscaleNoUpscale', inputs: { ...same, upscaled_image: [last, 0], seed: seed + i } };
    last = id;
  }
  wf[SAVE_NODE] = { class_type: 'PreviewImage', inputs: { images: [last, 0] } };
  return { workflow: wf, width, height, seed };
}

// ---- Talking to ComfyUI ----
const base = (url) => String(url).replace(/\/+$/, '');
const fail = (code, message) => Object.assign(new Error(message), { code });

async function comfy(url, path, { method = 'GET', body, signal, timeoutMs = 15000, raw = false } = {}) {
  const signals = [AbortSignal.timeout(timeoutMs), signal].filter(Boolean);
  let res;
  try {
    res = await fetch(`${base(url)}${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: signals.length > 1 ? AbortSignal.any(signals) : signals[0],
    });
  } catch (err) {
    if (signal?.aborted) throw fail('ABORTED', 'Stopped');
    throw fail('UNAVAILABLE', `ComfyUI isn't reachable at ${base(url)}`);
  }
  if (raw) {
    if (!res.ok) throw fail('ENGINE', `ComfyUI answered ${res.status}`);
    return { buffer: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get('content-type') || 'image/png' };
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(fail('ENGINE', `ComfyUI answered ${res.status}`), { status: res.status, data });
  return data;
}

// A loader's list of files from /object_info (old style [[...]] or the newer
// ['COMBO', { options }]), or [] when this ComfyUI doesn't say.
async function loaderOptions(url, node, input) {
  try {
    const data = await comfy(url, `/object_info/${node}`, { timeoutMs: 8000 });
    const spec = data?.[node]?.input?.required?.[input];
    const list = Array.isArray(spec?.[0]) ? spec[0] : spec?.[1]?.options;
    return Array.isArray(list) ? list.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

// Which of these nodes this ComfyUI lacks (P3-33), cached per address and
// node for 10 minutes, so a removed custom node is noticed without asking
// ComfyUI on every image.
const nodeCache = new Map();
async function missingNodes(url, names) {
  const out = [];
  for (const name of names) {
    const key = `${url} ${name}`;
    const hit = nodeCache.get(key);
    const has = hit && Date.now() - hit.at < 10 * 60 * 1000 ? hit.has : await hasNode(url, name);
    if (!hit || hit.has !== has) nodeCache.set(key, { at: Date.now(), has });
    if (!has) out.push(name);
  }
  return out;
}

// Whether this ComfyUI has a node (e.g. a custom node like Ultimate SD Upscale).
async function hasNode(url, node) {
  try {
    const data = await comfy(url, `/object_info/${node}`, { timeoutMs: 8000 });
    return !!data?.[node];
  } catch {
    return false;
  }
}

// The upscale model to use: the saved one, or (P3-29 fix for the hires fix)
// the suggestion from this ComfyUI's list, cached per address for 10 minutes.
const upscalerCache = new Map();
const detectorCache = new Map();
async function resolveDetector(cfg) {
  if (cfg.detector) return cfg.detector;
  const hit = detectorCache.get(cfg.url);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.name;
  const name = suggestDetector(await loaderOptions(cfg.url, 'UltralyticsDetectorProvider', 'model_name'));
  detectorCache.set(cfg.url, { at: Date.now(), name });
  return name;
}
async function resolveUpscaler(cfg) {
  if (cfg.upscaler) return cfg.upscaler;
  const hit = upscalerCache.get(cfg.url);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.name;
  const name = suggestUpscaler(await loaderOptions(cfg.url, 'UpscaleModelLoader', 'model_name'));
  upscalerCache.set(cfg.url, { at: Date.now(), name });
  return name;
}

// Put an image into ComfyUI's input folder (POST /upload/image); returns the
// name LoadImage takes.
async function uploadImage(url, { buffer, contentType = 'image/png', filename }, signal) {
  const form = new FormData();
  form.append('image', new Blob([buffer], { type: contentType }), filename);
  form.append('overwrite', 'true');
  let res;
  try {
    res = await fetch(`${base(url)}/upload/image`, { method: 'POST', body: form, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000) });
  } catch {
    if (signal?.aborted) throw fail('ABORTED', 'Stopped');
    throw fail('UNAVAILABLE', `ComfyUI isn't reachable at ${base(url)}`);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.name) throw fail('ENGINE', `ComfyUI didn't take the image (${res.status})`);
  return data.subfolder ? `${data.subfolder}/${data.name}` : data.name;
}

// What ComfyUI can load: checkpoints, plus (P3-24) image diffusion models with
// the text encoders and VAEs they need. { models: [{ name, kind, family }],
// clips, vaes, suggested: { flux: parts, zimage: parts } }.
async function listAll(url) {
  const data = await comfy(url, '/object_info/CheckpointLoaderSimple', { timeoutMs: 8000 });
  const spec = data?.CheckpointLoaderSimple?.input?.required?.ckpt_name;
  const names = Array.isArray(spec?.[0]) ? spec[0] : spec?.[1]?.options;
  if (!Array.isArray(names)) throw fail('ENGINE', 'That address answered, but not like ComfyUI');
  const [unets, clips, vaes, upscalers, tiledAvailable, samplers, schedulers, detectors, hasFaceDetailer, tiledPassesAvailable] = await Promise.all([
    loaderOptions(url, 'UNETLoader', 'unet_name'),
    loaderOptions(url, 'CLIPLoader', 'clip_name'),
    loaderOptions(url, 'VAELoader', 'vae_name'),
    loaderOptions(url, 'UpscaleModelLoader', 'model_name'),
    hasNode(url, 'UltimateSDUpscale'),
    // P3-31: what the advanced settings can choose from.
    loaderOptions(url, 'KSampler', 'sampler_name'),
    loaderOptions(url, 'KSampler', 'scheduler'),
    loaderOptions(url, 'UltralyticsDetectorProvider', 'model_name'),
    hasNode(url, 'FaceDetailer'),
    hasNode(url, 'UltimateSDUpscaleNoUpscale'), // P3-33: extra tiled passes
  ]);
  const models = names.map((name) => ({ name, kind: 'checkpoint', family: guessFamily(name) }));
  for (const name of unets.filter((n) => !VIDEO.test(n))) {
    const family = guessSplitFamily(name);
    models.push({ name, kind: 'unet', family });
  }
  // The parts each split family probably wants (the same for every model of it).
  const suggested = Object.fromEntries(SPLIT_FAMILIES.map((f) => [f, suggestParts(f, clips, vaes)]));
  // The hires fix's upscale model (P3-28): a general-purpose 4× one if there is one.
  suggested.upscaler = suggestUpscaler(upscalers);
  suggested.detector = suggestDetector(detectors);
  const detailerAvailable = hasFaceDetailer && detectors.length > 0;
  return { models, clips, vaes, upscalers, suggested, tiledAvailable, tiledPassesAvailable, samplers, schedulers, detectors, detailerAvailable };
}
// Kept for callers that only need the model list.
async function listModels(url) {
  return (await listAll(url)).models;
}

// A /prompt refusal in plain words.
function promptError(err, cfg, custom = false) {
  // A node type ComfyUI doesn't know (a custom workflow's node gone, P3-34).
  const top = err.data?.error || {};
  const missing = top.extra_info?.class_type || (`${top.message || ''}`.match(/Node '([^']+)' not found|node (\S+) does not exist/i) || []).slice(1).find(Boolean);
  if (top.type === 'missing_node_type' || missing) {
    const name = missing || 'a node';
    return fail('ENGINE', custom ? `Your custom workflow needs ${name}, which ComfyUI doesn't have` : `ComfyUI doesn't have the node ${name}`);
  }
  const nodeErrors = err.data && err.data.node_errors ? Object.values(err.data.node_errors) : [];
  const all = nodeErrors.flatMap((n) => n.errors || []);
  const says = (re) => all.some((e) => re.test(`${e.details || ''} ${e.message || ''}`));
  // P3-31: the face detector (node 40) and the advanced sampler / scheduler.
  if (err.data?.node_errors?.['40']) return fail('ENGINE', `The face detector "${cfg.detector}" isn't in ComfyUI any more`);
  if (says(/sampler_name/)) return fail('ENGINE', `ComfyUI doesn't have the sampler "${cfg.sampler}"`);
  if (says(/scheduler/)) return fail('ENGINE', `ComfyUI doesn't have the scheduler "${cfg.scheduler}"`);
  if (says(/ckpt_name|unet_name/)) return fail('ENGINE', `The model "${cfg.model}" isn't in ComfyUI any more`);
  if (says(/clip_name/)) return fail('ENGINE', `A text encoder (${[cfg.clip1, cfg.clip2].filter(Boolean).join(', ')}) isn't in ComfyUI any more`);
  if (says(/vae_name/)) return fail('ENGINE', `The VAE "${cfg.vae}" isn't in ComfyUI any more`);
  if (says(/model_name/)) return fail('ENGINE', `The upscale model "${cfg.upscaler}" isn't in ComfyUI any more`);
  const first = all[0] || err.data?.error;
  return fail('ENGINE', first ? `ComfyUI refused the workflow: ${first.message || first}` : err.message);
}

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(fail('ABORTED', 'Stopped'));
    }, { once: true });
  });

// Take a prompt back: out of the queue if it's waiting, interrupted if running.
async function cancel(url, promptId) {
  try {
    const q = await comfy(url, '/queue', { timeoutMs: 5000 });
    const running = (q?.queue_running || []).some((item) => item[1] === promptId);
    if (running) await comfy(url, '/interrupt', { method: 'POST', body: {}, timeoutMs: 5000 });
    else await comfy(url, '/queue', { method: 'POST', body: { delete: [promptId] }, timeoutMs: 5000 });
  } catch {
    /* best effort */
  }
}

// ---- Custom workflows (P3-34) ----
// The host's own workflow from ComfyUI's Export (API), with placeholders that
// DisGourd fills per request. Anything else in it is left as the host built it.
const PLACEHOLDERS = {
  generate: ['prompt', 'negative', 'seed', 'width', 'height', 'steps', 'quality'],
  upscale: ['image', 'scale', 'prompt', 'negative', 'seed'],
  // P3-36b: starting from a picture (Variations and "Start from an image").
  img2img: ['image', 'denoise', 'prompt', 'negative', 'seed', 'width', 'height', 'steps', 'quality'],
};
const REQUIRED_PLACEHOLDER = { generate: 'prompt', upscale: 'image', img2img: 'image' };
const NUMERIC = new Set(['seed', 'width', 'height', 'steps', 'scale', 'denoise']);
const MAX_WORKFLOW_BYTES = 256 * 1024;
const TOKEN = /\{\{\s*(\w+)\s*\}\}/g;

// Check a workflow (JSON text or an object) for `kind` ('generate' or
// 'upscale'): { workflow, classTypes } or { error }.
function checkWorkflow(input, kind = 'generate') {
  let wf = input;
  if (typeof input === 'string') {
    if (Buffer.byteLength(input) > MAX_WORKFLOW_BYTES) return { error: 'The workflow is over 256 KB' };
    try {
      wf = JSON.parse(input);
    } catch {
      return { error: 'That isn’t valid JSON' };
    }
  } else if (Buffer.byteLength(JSON.stringify(input || null)) > MAX_WORKFLOW_BYTES) {
    return { error: 'The workflow is over 256 KB' };
  }
  if (wf && typeof wf === 'object' && Array.isArray(wf.nodes)) return { error: 'That’s the regular workflow file. In ComfyUI, use Export (API) instead' };
  const nodes = wf && typeof wf === 'object' && !Array.isArray(wf) ? Object.values(wf) : [];
  if (!nodes.length || !nodes.every((n) => n && typeof n === 'object' && typeof n.class_type === 'string' && n.inputs && typeof n.inputs === 'object')) {
    return { error: 'That doesn’t look like a ComfyUI API workflow (each node needs class_type and inputs). Use Export (API)' };
  }
  const found = new Set();
  for (const n of nodes) {
    for (const v of Object.values(n.inputs)) if (typeof v === 'string') for (const m of v.matchAll(TOKEN)) found.add(m[1]);
  }
  const unknown = [...found].filter((p) => !PLACEHOLDERS[kind].includes(p));
  if (unknown.length) return { error: `Unknown placeholder${unknown.length > 1 ? 's' : ''}: ${unknown.map((p) => `{{${p}}}`).join(', ')}. Use ${PLACEHOLDERS[kind].map((p) => `{{${p}}}`).join(', ')}` };
  if (!found.has(REQUIRED_PLACEHOLDER[kind])) return { error: `The workflow needs {{${REQUIRED_PLACEHOLDER[kind]}}} in one of its fields` };
  return { workflow: wf, classTypes: [...new Set(nodes.map((n) => n.class_type))] };
}

// Which of a workflow's node types this ComfyUI doesn't have (asked fresh).
async function workflowMissingNodes(url, classTypes) {
  const has = await Promise.all(classTypes.map((c) => hasNode(url, c)));
  return classTypes.filter((_, i) => !has[i]);
}

// A copy of the workflow with the placeholders filled: a field that is just
// one placeholder takes the value's own type (numbers stay numbers); inside
// longer text it's replaced in place.
function fillWorkflow(wf, values) {
  const out = JSON.parse(JSON.stringify(wf));
  for (const node of Object.values(out)) {
    for (const [k, v] of Object.entries(node.inputs)) {
      if (typeof v !== 'string' || !v.includes('{{')) continue;
      const whole = v.match(/^\{\{\s*(\w+)\s*\}\}$/);
      if (whole && whole[1] in values) node.inputs[k] = NUMERIC.has(whole[1]) ? Number(values[whole[1]]) : values[whole[1]];
      else node.inputs[k] = v.replace(TOKEN, (m, name) => (name in values ? String(values[name]) : m));
    }
  }
  return out;
}

// The host's workflow for one request (`image`: the uploaded name, for an upscale).
function buildCustomWorkflow(wf, request, cfg, { permissive = false, image = null, seed = crypto.randomInt(0, 2 ** 32) } = {}) {
  const family = FAMILIES[cfg.family] ? cfg.family : 'sdxl';
  const f = FAMILIES[family];
  const negative = negativeFor(family, cfg, permissive);
  if (request.upscale) {
    const { width: w0, height: h0, factor } = request.upscale;
    const values = { image, scale: factor, prompt: request.prompt, negative, seed };
    return { workflow: fillWorkflow(wf, values), width: Math.round((w0 * factor) / 8) * 8, height: Math.round((h0 * factor) / 8) * 8, seed, custom: true };
  }
  const { width, height } = sizeFor(family, request.quality, request.shape, cfg.tier);
  const values = { prompt: request.prompt, negative, seed, width, height, steps: stepsFor(f, cfg, request.quality), quality: request.quality };
  if (request.init) Object.assign(values, { image, denoise: request.init.denoise }); // P3-36b
  return { workflow: fillWorkflow(wf, values), width, height, seed, custom: true };
}

async function generate(request, cfg, { permissive = false, signal } = {}) {
  // A style's prompt prefix (P9-04a), e.g. "anime screencap, ", goes first.
  if (cfg.promptPrefix) request = { ...request, prompt: `${cfg.promptPrefix}${request.prompt}` };
  // P3-34: the host's own workflow, when chosen (an upscale without its own
  // upscale workflow keeps the built-in one). Nothing built-in is added to it.
  // Starting from a picture (P3-36b) uses the host's image-to-image workflow;
  // without one, the built-in img2img (as an upscale without its own workflow).
  const customWf = cfg.workflowMode === 'custom'
    ? (request.upscale ? cfg.upscaleWorkflow : request.init ? cfg.img2imgWorkflow : cfg.workflow)
    : null;
  if (customWf) {
    const source = request.upscale || request.init;
    const image = source
      ? await uploadImage(cfg.url, { ...source, filename: `disgourd-${request.upscale ? 'upscale' : 'vary'}-${crypto.randomBytes(6).toString('hex')}.${source.ext || 'png'}` }, signal)
      : null;
    return run(buildCustomWorkflow(customWf, request, cfg, { permissive, image }), cfg, signal, []);
  }
  // The hires fix and the Upscale button need an upscale model: the saved one,
  // or the one suggested from this ComfyUI's list.
  const wantsUpscaler = !!request.upscale || (request.quality === 'high' && cfg.hires !== false);
  cfg = wantsUpscaler ? { ...cfg, upscaler: await resolveUpscaler(cfg) } : cfg;
  // The face detailer (P3-31) likewise: the saved detector, or the suggested one.
  if (!request.upscale && cfg.detailer && DETAILER_QUALITIES.includes(request.quality)) cfg = { ...cfg, detector: await resolveDetector(cfg) };
  // Missing custom nodes (P3-33): leave the feature out rather than fail.
  const notes = [];
  const without = async (on, need, off, what) => {
    if (!on) return;
    const missing = await missingNodes(cfg.url, need);
    if (missing.length) {
      cfg = { ...cfg, ...off };
      notes.push(`${what}: ComfyUI is missing ${missing.join(', ')}`);
    }
  };
  await without(!request.upscale && detailerFor(request, cfg), NEEDS.detailer, { detailer: false }, 'made without the face detailer');
  await without(!!request.upscale && cfg.upscaleMode === 'tiled', NEEDS.tiled, { upscaleMode: 'model' }, 'upscaled with the upscale model only');
  await without(!!request.upscale && cfg.upscaleMode === 'tiled' && (cfg.tilePasses || 1) > 1, NEEDS.tilePasses, { tilePasses: 1 }, 'one tiled pass only');
  let built;
  if (request.upscale) {
    if (!cfg.upscaler) throw fail('ENGINE', 'ComfyUI has no upscale models (models/upscale_models)');
    const name = await uploadImage(cfg.url, { ...request.upscale, filename: `disgourd-upscale-${crypto.randomBytes(6).toString('hex')}.${request.upscale.ext || 'png'}` }, signal);
    built = buildUpscaleWorkflow(request, cfg, name, { permissive });
  } else {
    // img2img (P3-36a): put the starting image into ComfyUI first.
    if (request.init) {
      const initName = await uploadImage(cfg.url, { ...request.init, filename: `disgourd-vary-${crypto.randomBytes(6).toString('hex')}.${request.init.ext || 'png'}` }, signal);
      request = { ...request, initName };
    }
    built = buildWorkflow(request, cfg, { permissive });
  }
  return run(built, cfg, signal, notes);
}

// Queue a built workflow, wait for it, and fetch its images (the built-in
// ones save from node 9; a custom workflow's come from every output node).
async function run(built, cfg, signal, notes) {
  const { workflow, width, height } = built;
  let queued;
  try {
    queued = await comfy(cfg.url, '/prompt', { method: 'POST', body: { prompt: workflow, client_id: `disgourd-${crypto.randomUUID()}` }, signal });
  } catch (err) {
    if (err.code === 'ENGINE' && err.data) throw promptError(err, cfg, built.custom);
    throw err;
  }
  const promptId = queued && queued.prompt_id;
  if (!promptId) throw fail('ENGINE', 'ComfyUI did not queue the prompt');
  const pollMs = parseInt(process.env.IMAGINE_COMFY_POLL_MS, 10) || 750;
  try {
    for (;;) {
      await sleep(pollMs, signal);
      const history = await comfy(cfg.url, `/history/${encodeURIComponent(promptId)}`, { signal });
      const entry = history && history[promptId];
      if (!entry) continue;
      const status = entry.status || {};
      if (status.status_str === 'error') {
        const execErr = (status.messages || []).find((m) => m[0] === 'execution_error');
        throw fail('ENGINE', execErr ? `ComfyUI failed: ${execErr[1].exception_message || 'error'}`.trim() : 'ComfyUI failed');
      }
      if (status.completed === false) continue;
      const files = built.custom
        ? Object.values(entry.outputs || {}).flatMap((o) => o.images || []).slice(0, 4)
        : entry.outputs?.[SAVE_NODE]?.images || [];
      if (!files.length) throw fail('ENGINE', 'ComfyUI finished without an image');
      const images = [];
      for (const f of files) {
        const qs = new URLSearchParams({ filename: f.filename, subfolder: f.subfolder || '', type: f.type || 'temp' });
        images.push(await comfy(cfg.url, `/view?${qs}`, { raw: true, signal, timeoutMs: 60000 }));
      }
      return { model: cfg.model, width, height, images, notes };
    }
  } catch (err) {
    if (err.code === 'ABORTED' || signal?.aborted) {
      await cancel(cfg.url, promptId);
      throw fail('ABORTED', 'Stopped');
    }
    throw err;
  }
}

// ---- Settings ----
// One flat setup (shared settings plus one style's), as before P9-04a.
function validateFlat(input, prev = {}) {
  const i = input && typeof input === 'object' ? input : {};
  const cfg = { ...prev };
  if (i.enabled !== undefined) cfg.enabled = !!i.enabled;
  if (i.url !== undefined) {
    let u;
    try {
      u = new URL(String(i.url).trim());
    } catch {
      return { error: 'The ComfyUI address must be a URL like http://192.168.1.20:8188' };
    }
    if (!/^https?:$/.test(u.protocol) || u.username || u.password) return { error: 'The ComfyUI address must be http(s), without a username or password' };
    cfg.url = base(u.toString());
  }
  if (i.kind !== undefined) {
    if (i.kind !== 'checkpoint' && i.kind !== 'unet') return { error: 'Unknown model kind' };
    cfg.kind = i.kind;
  }
  if (i.model !== undefined) {
    if (i.model !== null && (typeof i.model !== 'string' || !i.model.trim() || i.model.length > 300)) return { error: 'Pick a model' };
    cfg.model = i.model;
    if (i.family === undefined && i.model) cfg.family = cfg.kind === 'unet' ? guessSplitFamily(i.model) : guessFamily(i.model);
  }
  // The parts of a split model (P3-24): file names from this ComfyUI's lists.
  for (const k of ['clip1', 'clip2', 'vae']) {
    if (i[k] === undefined) continue;
    if (i[k] !== null && (typeof i[k] !== 'string' || !i[k].trim() || i[k].length > 300)) return { error: 'Pick the text encoders and VAE from the lists' };
    cfg[k] = i[k];
  }
  if (i.family !== undefined) {
    if (i.family !== null && !FAMILIES[i.family]) return { error: 'The model type must be SD 1.5, SDXL, Flux or Z-Image Turbo' };
    cfg.family = i.family;
  }
  cfg.kind = cfg.kind || 'checkpoint';
  if (cfg.kind === 'unet') {
    if (cfg.model && !SPLIT_FAMILIES.includes(cfg.family)) return { error: 'For a model in separate parts, pick its type: Flux, Z-Image Turbo or Anima' };
    if (cfg.enabled && (!cfg.clip1 || !cfg.vae || (cfg.family === 'flux' && !cfg.clip2))) {
      return { error: cfg.family === 'flux' ? 'Pick both text encoders and the VAE for this model' : 'Pick the text encoder and the VAE for this model' };
    }
  } else if (FAMILIES[cfg.family]?.splitOnly) {
    return { error: 'Z-Image Turbo comes as separate parts, not a checkpoint' };
  }
  // The hires fix (P3-28): on unless switched off; its upscale model by name.
  if (i.hires !== undefined) cfg.hires = !!i.hires;
  if (i.upscaler !== undefined) {
    if (i.upscaler !== null && (typeof i.upscaler !== 'string' || !i.upscaler.trim() || i.upscaler.length > 300)) return { error: 'Pick an upscale model from the list' };
    cfg.upscaler = i.upscaler;
  }
  // The Upscale button (P3-29): its mode and, for tiled, denoise and tile size.
  if (i.upscaleMode !== undefined) {
    if (!UPSCALE_MODES.includes(i.upscaleMode)) return { error: 'The upscale mode must be "model" or "tiled"' };
    cfg.upscaleMode = i.upscaleMode;
  }
  if (i.tileDenoise !== undefined) {
    if (typeof i.tileDenoise !== 'number' || !(i.tileDenoise >= 0.05 && i.tileDenoise <= 0.6)) return { error: 'The tiled denoise is 0.05–0.6' };
    cfg.tileDenoise = Math.round(i.tileDenoise * 100) / 100;
  }
  if (i.tileSize !== undefined) {
    if (!Number.isInteger(i.tileSize) || i.tileSize < 512 || i.tileSize > 2048 || i.tileSize % 64) return { error: 'The tile size is 512–2048, in steps of 64' };
    cfg.tileSize = i.tileSize;
  }
  // Advanced (P3-31): null clears a value back to the model type's default.
  const text = (v, max) => v === null || (typeof v === 'string' && v.length <= max);
  for (const k of ['sampler', 'scheduler']) {
    if (i[k] === undefined) continue;
    if (!text(i[k], 100)) return { error: `Pick the ${k} from the list` };
    cfg[k] = i[k] && i[k].trim() ? i[k].trim() : null;
  }
  if (i.cfgScale !== undefined) {
    if (i.cfgScale !== null && (typeof i.cfgScale !== 'number' || !(i.cfgScale >= 0 && i.cfgScale <= 30))) return { error: 'CFG is 0–30' };
    cfg.cfgScale = i.cfgScale === null ? null : Math.round(i.cfgScale * 10) / 10;
  }
  if (i.steps !== undefined) {
    if (i.steps !== null && (typeof i.steps !== 'object' || Array.isArray(i.steps))) return { error: 'Steps must be per quality' };
    const steps = {};
    for (const q of ['draft', 'standard', 'high']) {
      const v = i.steps ? i.steps[q] : null;
      if (v === null || v === undefined || v === '') continue;
      if (!Number.isInteger(v) || v < 1 || v > 150) return { error: 'Steps are 1–150' };
      steps[q] = v;
    }
    cfg.steps = Object.keys(steps).length ? steps : null;
  }
  if (i.negative !== undefined) {
    if (!text(i.negative, 1000)) return { error: 'The negative prompt is up to 1000 characters' };
    cfg.negative = i.negative && i.negative.trim() ? i.negative.trim() : null;
  }
  // A style's prompt prefix (P9-04a): put before every prompt in that style.
  if (i.promptPrefix !== undefined) {
    if (!text(i.promptPrefix, 300)) return { error: 'The prompt prefix is up to 300 characters' };
    cfg.promptPrefix = i.promptPrefix && i.promptPrefix.trim() ? `${i.promptPrefix.trim()} ` : null;
  }
  if (i.detailer !== undefined) cfg.detailer = !!i.detailer;
  if (i.detector !== undefined) {
    if (!text(i.detector, 300)) return { error: 'Pick a face detector from the list' };
    cfg.detector = i.detector || null;
  }
  // Passes (P3-33).
  if (i.detailerPasses !== undefined) {
    if (!Number.isInteger(i.detailerPasses) || i.detailerPasses < 1 || i.detailerPasses > MAX_DETAILER_PASSES) return { error: `Face detailer passes are 1–${MAX_DETAILER_PASSES}` };
    cfg.detailerPasses = i.detailerPasses;
  }
  if (i.tilePasses !== undefined) {
    if (!Number.isInteger(i.tilePasses) || i.tilePasses < 1 || i.tilePasses > MAX_TILE_PASSES) return { error: `Tiled passes are 1–${MAX_TILE_PASSES}` };
    cfg.tilePasses = i.tilePasses;
  }
  // Variation strengths (P3-36a): how much each loop repaints.
  for (const [k, lo, hi] of [['varySubtle', 0.1, 0.6], ['varyStrong', 0.3, 0.9]]) {
    if (i[k] === undefined) continue;
    if (typeof i[k] !== 'number' || !(i[k] >= lo && i[k] <= hi)) return { error: `${k === 'varySubtle' ? 'Subtle' : 'Strong'} variation strength is ${lo}–${hi}` };
    cfg[k] = Math.round(i[k] * 100) / 100;
  }
  if (i.varyLoops !== undefined) {
    if (!Number.isInteger(i.varyLoops) || i.varyLoops < 1 || i.varyLoops > MAX_LOOPS) return { error: `Variation loops are 1–${MAX_LOOPS}` };
    cfg.varyLoops = i.varyLoops;
  }
  if (i.detailerDenoise !== undefined) {
    if (typeof i.detailerDenoise !== 'number' || !(i.detailerDenoise >= 0.1 && i.detailerDenoise <= 0.8)) return { error: 'The face detailer strength is 0.1–0.8' };
    cfg.detailerDenoise = Math.round(i.detailerDenoise * 100) / 100;
  }
  if (i.tier !== undefined) {
    if (!TIERS[i.tier]) return { error: 'The VRAM tier must be low, medium or high' };
    cfg.tier = i.tier;
  }
  cfg.tier = cfg.tier || 'medium';
  if (cfg.kind === 'checkpoint') cfg.family = cfg.family || (cfg.model ? guessFamily(cfg.model) : 'sdxl');
  // Custom workflows (P3-34): stored parsed; node checks happen on save.
  if (i.workflowMode !== undefined) {
    if (!['builtin', 'custom'].includes(i.workflowMode)) return { error: 'The workflow must be "builtin" or "custom"' };
    cfg.workflowMode = i.workflowMode;
  }
  for (const [key, kind, label] of [['workflow', 'generate', 'Workflow'], ['upscaleWorkflow', 'upscale', 'Upscale workflow'], ['img2imgWorkflow', 'img2img', 'Image-to-image workflow']]) {
    if (i[key] === undefined) continue;
    if (i[key] === null || (typeof i[key] === 'string' && !i[key].trim())) {
      cfg[key] = null;
      continue;
    }
    const checked = checkWorkflow(i[key], kind);
    if (checked.error) return { error: `${label}: ${checked.error}` };
    cfg[key] = checked.workflow;
  }
  if (cfg.workflowMode === 'custom' && !cfg.workflow) return { error: 'Add your workflow (Export (API) in ComfyUI) before choosing My own' };
  if (cfg.enabled && (!cfg.url || (!cfg.model && cfg.workflowMode !== 'custom'))) return { error: 'Set the ComfyUI address and pick a model before turning it on' };
  return cfg;
}
// ---- Styles (P9-04a) ----
// What belongs to one style; everything else is shared by every style.
const STYLE_KEYS = ['kind', 'model', 'family', 'clip1', 'clip2', 'vae', 'sampler', 'scheduler', 'steps', 'cfgScale', 'negative', 'promptPrefix', 'workflowMode', 'workflow', 'upscaleWorkflow', 'img2imgWorkflow'];
const MAX_STYLES = 20;
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
const omit = (o, keys) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));
// A saved config in the styles shape. One from before styles has its single
// setup turned into the first style, "Default", so nothing is lost.
function normalizeConfig(cfg = {}) {
  if (Array.isArray(cfg.presets) && cfg.presets.length) {
    const ids = cfg.presets.map((p) => p.id);
    return { ...omit(cfg, STYLE_KEYS), defaultPreset: ids.includes(cfg.defaultPreset) ? cfg.defaultPreset : ids[0] };
  }
  return { ...omit(cfg, STYLE_KEYS), presets: [{ id: 'default', name: 'Default', ...pick(cfg, STYLE_KEYS) }], defaultPreset: 'default' };
}
// The flat setup one style runs with: the shared settings plus the style's
// own. An unknown or deleted style falls back to the default (`fellBack`).
function styleConfig(cfg = {}, presetId = null) {
  const n = normalizeConfig(cfg);
  const found = presetId ? n.presets.find((p) => p.id === presetId) : null;
  const preset = found || n.presets.find((p) => p.id === n.defaultPreset) || n.presets[0];
  return { config: { ...omit(n, ['presets', 'defaultPreset']), ...omit(preset, ['id', 'name']) }, preset, fellBack: !!presetId && !found };
}
// The styles people can pick: [{ id, name }], and the default's id.
function styleList(cfg = {}) {
  const n = normalizeConfig(cfg);
  return { styles: n.presets.map((p) => ({ id: p.id, name: p.name })), defaultStyle: n.defaultPreset };
}
const slug = (name) => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'style';

// Settings come in two shapes. `presets: [{ id?, name, …style }]` (with
// `defaultPreset`) replaces the list; or the older flat fields, which change
// the default style (what the settings screen sends until it learns styles).
// Each style is checked as a whole setup would be.
function validateConfig(input, prev = {}) {
  const i = input && typeof input === 'object' ? input : {};
  const base = normalizeConfig(prev);
  const shared = omit(base, ['presets', 'defaultPreset']);
  const sharedIn = omit(i, [...STYLE_KEYS, 'presets', 'defaultPreset']);
  let entries;
  if (i.presets !== undefined) {
    if (!Array.isArray(i.presets) || !i.presets.length) return { error: 'Keep at least one style' };
    if (i.presets.length > MAX_STYLES) return { error: `At most ${MAX_STYLES} styles` };
    const names = new Set();
    const ids = new Set();
    entries = [];
    for (const raw of i.presets) {
      if (!raw || typeof raw !== 'object') return { error: 'Each style needs a name' };
      const name = typeof raw.name === 'string' ? raw.name.trim() : '';
      if (!name || name.length > 30) return { error: 'Style names are 1–30 characters' };
      if (names.has(name.toLowerCase())) return { error: `There are two styles called "${name}"` };
      names.add(name.toLowerCase());
      let id = typeof raw.id === 'string' && /^[a-z0-9-]{1,40}$/.test(raw.id) ? raw.id : slug(name);
      for (let n = 2; ids.has(id); n++) id = `${slug(name)}-${n}`;
      ids.add(id);
      entries.push({ id, name, input: pick(raw, STYLE_KEYS), prev: base.presets.find((p) => p.id === raw.id) || {} });
    }
  } else {
    const legacy = pick(i, STYLE_KEYS);
    entries = base.presets.map((p) => ({ id: p.id, name: p.name, input: p.id === base.defaultPreset ? legacy : {}, prev: p }));
  }
  let newShared = null;
  const presets = [];
  for (const e of entries) {
    const flat = validateFlat({ ...sharedIn, ...e.input }, { ...shared, ...pick(e.prev, STYLE_KEYS) });
    if (flat.error) return { error: entries.length > 1 ? `${e.name}: ${flat.error}` : flat.error };
    newShared = newShared || omit(flat, STYLE_KEYS);
    presets.push({ id: e.id, name: e.name, ...pick(flat, STYLE_KEYS) });
  }
  const wanted = i.defaultPreset !== undefined ? i.defaultPreset : base.defaultPreset;
  const defaultPreset = presets.some((p) => p.id === wanted) ? wanted : i.defaultPreset !== undefined ? null : presets[0].id;
  if (!defaultPreset) return { error: 'Pick which style is the default' };
  return { ...newShared, presets, defaultPreset };
}

const publicFlat = (cfg = {}) => ({
  enabled: !!cfg.enabled, url: cfg.url || '', model: cfg.model || null, family: cfg.family || null, tier: cfg.tier || 'medium',
  kind: cfg.kind || 'checkpoint', clip1: cfg.clip1 || null, clip2: cfg.clip2 || null, vae: cfg.vae || null,
  hires: cfg.hires !== false, upscaler: cfg.upscaler || null,
  upscaleMode: cfg.upscaleMode || 'model', tileDenoise: cfg.tileDenoise ?? TILE.denoise, tileSize: cfg.tileSize || TILE.size,
  sampler: cfg.sampler || null, scheduler: cfg.scheduler || null, cfgScale: cfg.cfgScale ?? null, steps: cfg.steps || null, negative: cfg.negative || null,
  detailer: !!cfg.detailer, detector: cfg.detector || null, detailerDenoise: cfg.detailerDenoise ?? DETAILER_DENOISE,
  detailerPasses: cfg.detailerPasses || 1, tilePasses: cfg.tilePasses || 1, varyLoops: cfg.varyLoops || DEFAULT_LOOPS,
  varySubtle: cfg.varySubtle ?? 0.3, varyStrong: cfg.varyStrong ?? 0.65,
  workflowMode: cfg.workflowMode || 'builtin',
  workflow: cfg.workflow ? JSON.stringify(cfg.workflow, null, 2) : '',
  upscaleWorkflow: cfg.upscaleWorkflow ? JSON.stringify(cfg.upscaleWorkflow, null, 2) : '',
  img2imgWorkflow: cfg.img2imgWorkflow ? JSON.stringify(cfg.img2imgWorkflow, null, 2) : '',
  promptPrefix: cfg.promptPrefix ? cfg.promptPrefix.trimEnd() : '',
});
// What the settings screen sees: the shared settings and the default style's
// as flat fields (as before), plus every style (P9-04a).
function publicConfig(cfg = {}) {
  const n = normalizeConfig(cfg);
  const { config } = styleConfig(n);
  const stylePublic = (p) => {
    const flat = publicFlat({ ...omit(n, ['presets', 'defaultPreset']), ...omit(p, ['id', 'name']) });
    return { id: p.id, name: p.name, ...pick(flat, STYLE_KEYS) };
  };
  return { ...publicFlat(config), presets: n.presets.map(stylePublic), defaultPreset: n.defaultPreset };
}

module.exports = {
  id: 'comfyui',
  name: 'ComfyUI (local)',
  available: () => true,
  validateConfig,
  publicConfig,
  normalizeConfig,
  styleConfig,
  styleList,
  STYLE_KEYS,
  costOf: () => 0,
  pictures: () => ({ strength: true }), // P9-05a: img2img with a denoise strength
  generate,
  listModels,
  listAll,
  guessFamily,
  guessSplitFamily,
  suggestParts,
  suggestUpscaler,
  hiresSize,
  HIRES_MP,
  DETAILER_MAX,
  buildUpscaleWorkflow,
  resolveUpscaler,
  upscalerCache,
  detectorCache,
  nodeCache,
  missingNodes,
  checkWorkflow,
  workflowMissingNodes,
  fillWorkflow,
  buildCustomWorkflow,
  PLACEHOLDERS,
  suggestDetector,
  sizeFor,
  buildWorkflow,
  FAMILIES,
  TIERS,
};
