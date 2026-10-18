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

// The API-format workflow for one request.
function buildWorkflow(request, cfg, { permissive = false, seed = crypto.randomInt(0, 2 ** 32) } = {}) {
  const split = cfg.kind === 'unet';
  const family = FAMILIES[cfg.family] && (split || !FAMILIES[cfg.family].splitOnly) ? cfg.family : 'sdxl';
  const f = FAMILIES[family];
  const { width, height } = sizeFor(family, request.quality, request.shape, cfg.tier);
  const negative = family === 'flux' || family === 'zimage' ? '' : permissive ? NEGATIVE : `${NEGATIVE}, ${SAFE_NEGATIVE}`;
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
    5: { class_type: family === 'flux' || family === 'zimage' ? 'EmptySD3LatentImage' : 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } },
    6: { class_type: 'CLIPTextEncode', inputs: { text: request.prompt, clip } },
    7: { class_type: 'CLIPTextEncode', inputs: { text: negative, clip } },
    3: {
      class_type: 'KSampler',
      inputs: {
        seed, steps: f.steps[request.quality] || f.steps.standard, cfg: f.cfg, sampler_name: f.sampler, scheduler: f.scheduler, denoise: 1,
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

// What ComfyUI can load: checkpoints, plus (P3-24) image diffusion models with
// the text encoders and VAEs they need. { models: [{ name, kind, family }],
// clips, vaes, suggested: { flux: parts, zimage: parts } }.
async function listAll(url) {
  const data = await comfy(url, '/object_info/CheckpointLoaderSimple', { timeoutMs: 8000 });
  const spec = data?.CheckpointLoaderSimple?.input?.required?.ckpt_name;
  const names = Array.isArray(spec?.[0]) ? spec[0] : spec?.[1]?.options;
  if (!Array.isArray(names)) throw fail('ENGINE', 'That address answered, but not like ComfyUI');
  const [unets, clips, vaes] = await Promise.all([
    loaderOptions(url, 'UNETLoader', 'unet_name'),
    loaderOptions(url, 'CLIPLoader', 'clip_name'),
    loaderOptions(url, 'VAELoader', 'vae_name'),
  ]);
  const models = names.map((name) => ({ name, kind: 'checkpoint', family: guessFamily(name) }));
  for (const name of unets.filter((n) => !VIDEO.test(n))) {
    const family = guessSplitFamily(name);
    models.push({ name, kind: 'unet', family });
  }
  // The parts each split family probably wants (the same for every model of it).
  const suggested = Object.fromEntries(SPLIT_FAMILIES.map((f) => [f, suggestParts(f, clips, vaes)]));
  return { models, clips, vaes, suggested };
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
  if (says(/ckpt_name|unet_name/)) return fail('ENGINE', `The model "${cfg.model}" isn't in ComfyUI any more`);
  if (says(/clip_name/)) return fail('ENGINE', `A text encoder (${[cfg.clip1, cfg.clip2].filter(Boolean).join(', ')}) isn't in ComfyUI any more`);
  if (says(/vae_name/)) return fail('ENGINE', `The VAE "${cfg.vae}" isn't in ComfyUI any more`);
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
  const { workflow, width, height } = buildWorkflow(request, cfg, { permissive });
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
  sizeFor,
  buildWorkflow,
  FAMILIES,
  TIERS,
};
