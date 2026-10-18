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
};
// Families a split model (UNETLoader) can be.
const SPLIT_FAMILIES = ['flux', 'zimage'];
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
const DETAILER_QUALITIES = ['standard', 'high'];
const RATIOS = { square: [1, 1], portrait: [2, 3], landscape: [3, 2], wide: [16, 9] };
const NEGATIVE = 'lowres, worst quality, low quality, blurry, jpeg artifacts, watermark, signature, text';
const SAFE_NEGATIVE = 'nsfw, nude, nudity';
const SAVE_NODE = '9';

// A split model's likely family, or null when its name doesn't say.
function guessSplitFamily(name) {
  const n = String(name || '').toLowerCase();
  if (/z[_\- ]?image|zturbo/.test(n)) return 'zimage';
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
  return [own || NEGATIVE, permissive ? null : SAFE_NEGATIVE].filter(Boolean).join(', ');
}
// Whether a request gets the face detailer: switched on, a detector known, and
// Standard or High quality.
const detailerFor = (request, cfg) => !!cfg.detailer && !!cfg.detector && DETAILER_QUALITIES.includes(request.quality);

// The API-format workflow for one request.
function buildWorkflow(request, cfg, { permissive = false, seed = crypto.randomInt(0, 2 ** 32) } = {}) {
  const split = cfg.kind === 'unet';
  const family = FAMILIES[cfg.family] && (split || !FAMILIES[cfg.family].splitOnly) ? cfg.family : 'sdxl';
  const f = FAMILIES[family];
  const hires = hiresFor(request, cfg);
  // With the hires fix, the first pass is made at the Standard size.
  const base = sizeFor(family, hires ? 'standard' : request.quality, request.shape, cfg.tier);
  const { width, height } = hires ? hiresSize(base, cfg.tier) : base;
  const negative = negativeFor(family, cfg, permissive);
  const sampling = samplingFor(f, cfg);
  // Where the model, text encoder and VAE come from: one checkpoint (node 4),
  // or separate loaders (11 diffusion model, 12 text encoder(s), 13 VAE).
  const loaders = split
    ? {
        11: { class_type: 'UNETLoader', inputs: { unet_name: cfg.model, weight_dtype: 'default' } },
        12: family === 'flux'
          ? { class_type: 'DualCLIPLoader', inputs: { clip_name1: cfg.clip1, clip_name2: cfg.clip2, type: 'flux' } }
          : { class_type: 'CLIPLoader', inputs: { clip_name: cfg.clip1, type: 'lumina2' } },
        13: { class_type: 'VAELoader', inputs: { vae_name: cfg.vae } },
      }
    : { 4: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: cfg.model } } };
  const model = split ? ['11', 0] : ['4', 0];
  const clip = split ? ['12', 0] : ['4', 1];
  const vae = split ? ['13', 0] : ['4', 2];
  const wf = {
    ...loaders,
    5: { class_type: family === 'flux' || family === 'zimage' ? 'EmptySD3LatentImage' : 'EmptyLatentImage', inputs: { width: base.width, height: base.height, batch_size: 1 } },
    6: { class_type: 'CLIPTextEncode', inputs: { text: request.prompt, clip } },
    7: { class_type: 'CLIPTextEncode', inputs: { text: negative, clip } },
    3: {
      class_type: 'KSampler',
      inputs: {
        seed, steps: stepsFor(f, cfg, request.quality), ...sampling, denoise: 1,
        model, positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0],
      },
    },
    8: { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae } },
    [SAVE_NODE]: { class_type: 'PreviewImage', inputs: { images: ['8', 0] } },
  };
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
    wf[40] = { class_type: 'UltralyticsDetectorProvider', inputs: { model_name: cfg.detector } };
    wf[41] = {
      class_type: 'FaceDetailer',
      inputs: {
        image: wf[SAVE_NODE].inputs.images, model: wf[3].inputs.model, clip, vae, positive: wf[3].inputs.positive, negative: ['7', 0],
        guide_size: guide, guide_size_for: true, max_size: guide, seed, steps: stepsFor(f, cfg, 'standard'), ...sampling,
        denoise: cfg.detailerDenoise ?? DETAILER_DENOISE, feather: 5, noise_mask: true, force_inpaint: true,
        bbox_threshold: 0.5, bbox_dilation: 10, bbox_crop_factor: 3, sam_detection_hint: 'center-1', sam_dilation: 0, sam_threshold: 0.93,
        sam_bbox_expansion: 0, sam_mask_hint_threshold: 0.7, sam_mask_hint_use_negative: 'False', drop_size: 10,
        bbox_detector: ['40', 0], wildcard: '', cycle: 1,
      },
    };
    wf[SAVE_NODE].inputs.images = ['41', 0];
  }
  return { workflow: wf, width, height, seed, hires, detailer };
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
  wf[SAVE_NODE] = { class_type: 'PreviewImage', inputs: { images: ['30', 0] } };
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
  const [unets, clips, vaes, upscalers, tiledAvailable, samplers, schedulers, detectors, hasFaceDetailer] = await Promise.all([
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
  return { models, clips, vaes, upscalers, suggested, tiledAvailable, samplers, schedulers, detectors, detailerAvailable };
}
// Kept for callers that only need the model list.
async function listModels(url) {
  return (await listAll(url)).models;
}

// A /prompt refusal in plain words.
function promptError(err, cfg) {
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

async function generate(request, cfg, { permissive = false, signal } = {}) {
  // The hires fix and the Upscale button need an upscale model: the saved one,
  // or the one suggested from this ComfyUI's list.
  const wantsUpscaler = !!request.upscale || (request.quality === 'high' && cfg.hires !== false);
  cfg = wantsUpscaler ? { ...cfg, upscaler: await resolveUpscaler(cfg) } : cfg;
  // The face detailer (P3-31) likewise: the saved detector, or the suggested one.
  if (!request.upscale && cfg.detailer && DETAILER_QUALITIES.includes(request.quality)) cfg = { ...cfg, detector: await resolveDetector(cfg) };
  let built;
  if (request.upscale) {
    if (!cfg.upscaler) throw fail('ENGINE', 'ComfyUI has no upscale models (models/upscale_models)');
    const name = await uploadImage(cfg.url, { ...request.upscale, filename: `disgourd-upscale-${crypto.randomBytes(6).toString('hex')}.${request.upscale.ext || 'png'}` }, signal);
    built = buildUpscaleWorkflow(request, cfg, name, { permissive });
  } else {
    built = buildWorkflow(request, cfg, { permissive });
  }
  const { workflow, width, height } = built;
  let queued;
  try {
    queued = await comfy(cfg.url, '/prompt', { method: 'POST', body: { prompt: workflow, client_id: `disgourd-${crypto.randomUUID()}` }, signal });
  } catch (err) {
    if (err.code === 'ENGINE' && err.data) throw promptError(err, cfg);
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
      const files = entry.outputs?.[SAVE_NODE]?.images || [];
      if (!files.length) throw fail('ENGINE', 'ComfyUI finished without an image');
      const images = [];
      for (const f of files) {
        const qs = new URLSearchParams({ filename: f.filename, subfolder: f.subfolder || '', type: f.type || 'temp' });
        images.push(await comfy(cfg.url, `/view?${qs}`, { raw: true, signal, timeoutMs: 60000 }));
      }
      return { model: cfg.model, width, height, images };
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
function validateConfig(input, prev = {}) {
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
    if (cfg.model && !SPLIT_FAMILIES.includes(cfg.family)) return { error: 'For a model in separate parts, pick its type: Flux or Z-Image Turbo' };
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
  if (i.detailer !== undefined) cfg.detailer = !!i.detailer;
  if (i.detector !== undefined) {
    if (!text(i.detector, 300)) return { error: 'Pick a face detector from the list' };
    cfg.detector = i.detector || null;
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
  if (cfg.enabled && (!cfg.url || !cfg.model)) return { error: 'Set the ComfyUI address and pick a model before turning it on' };
  return cfg;
}
const publicConfig = (cfg = {}) => ({
  enabled: !!cfg.enabled, url: cfg.url || '', model: cfg.model || null, family: cfg.family || null, tier: cfg.tier || 'medium',
  kind: cfg.kind || 'checkpoint', clip1: cfg.clip1 || null, clip2: cfg.clip2 || null, vae: cfg.vae || null,
  hires: cfg.hires !== false, upscaler: cfg.upscaler || null,
  upscaleMode: cfg.upscaleMode || 'model', tileDenoise: cfg.tileDenoise ?? TILE.denoise, tileSize: cfg.tileSize || TILE.size,
  sampler: cfg.sampler || null, scheduler: cfg.scheduler || null, cfgScale: cfg.cfgScale ?? null, steps: cfg.steps || null, negative: cfg.negative || null,
  detailer: !!cfg.detailer, detector: cfg.detector || null, detailerDenoise: cfg.detailerDenoise ?? DETAILER_DENOISE,
});

module.exports = {
  id: 'comfyui',
  name: 'ComfyUI (local)',
  available: () => true,
  validateConfig,
  publicConfig,
  costOf: () => 0,
  generate,
  listModels,
  listAll,
  guessFamily,
  guessSplitFamily,
  suggestParts,
  suggestUpscaler,
  hiresSize,
  HIRES_MP,
  buildUpscaleWorkflow,
  resolveUpscaler,
  upscalerCache,
  detectorCache,
  suggestDetector,
  sizeFor,
  buildWorkflow,
  FAMILIES,
  TIERS,
};
