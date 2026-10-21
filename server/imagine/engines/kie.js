// The kie.ai engine (P2-20c): paid models through kie.ai's one task API.
// POST /api/v1/jobs/createTask { model, input } → poll /api/v1/jobs/recordInfo
// → download the result URLs (through safeFetch: public addresses, images
// only). Each model in the catalogue says how DisGourd's shape and quality map
// onto its inputs, and which content-filter switch it has; a custom model id
// gets the inputs most newer models share. Prices change, so the price shown
// is the last real `creditsConsumed` recorded for that model and quality,
// with the catalogue's estimate only until then.
//
// Pictures (P9-05a): "Start from a picture" and Variations use each model's
// image-to-image version. kie.ai can't reach this server, so the picture is
// uploaded to kie.ai's file storage first (free; deleted after 24 hours) and
// the task gets its URL. Z-Image and custom models have no picture version:
// `pictureModel` names one of the others for pictures (none = no pictures).
const crypto = require('crypto');
const db = require('../../db');
const { safeFetch } = require('../../net/safeFetch');
const { secretFromEnv } = require('../../secrets');

const API = () => (process.env.KIE_API_BASE || 'https://api.kie.ai').replace(/\/+$/, '');
const UPLOAD_API = () => (process.env.KIE_UPLOAD_BASE || 'https://kieai.redpandaai.co').replace(/\/+$/, '');
const BASE64_UPLOAD_MAX = 10 * 1024 * 1024; // larger pictures go up as a file stream
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const CUSTOM_ID_RE = /^[a-z0-9][a-z0-9._/-]{1,100}$/i;

const MB = 1024 * 1024;
// safety: 'nsfw_checker' (the model's switch), 'qwen' (its checker and the
// switch), or null (no switch: filtered upstream).
const MODELS = {
  'z-image': { name: 'Z-Image', note: 'Fast and inexpensive.', aspects: ['1:1', '4:3', '3:4', '16:9', '9:16'], safety: 'nsfw_checker', estimate: 0.8 },
  'flux-2/pro-text-to-image': {
    name: 'Flux-2 Pro', note: 'High quality; the same family as Flux in ComfyUI.', aspects: ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'],
    quality: { field: 'resolution', draft: '1K', standard: '1K', high: '2K' }, safety: 'nsfw_checker',
    picture: { model: 'flux-2/pro-image-to-image', field: 'input_urls', array: true, aspect: 'auto', maxBytes: 10 * MB, estimate: 5 },
  },
  'seedream/5-lite-text-to-image': {
    name: 'Seedream 5.0 Lite', note: 'Detailed 2K images (3K at High).', aspects: ['1:1', '4:3', '3:4', '16:9', '9:16', '2:3', '3:2', '21:9'],
    quality: { field: 'quality', draft: 'basic', standard: 'basic', high: 'high' }, safety: 'nsfw_checker', extra: { output_format: 'png' },
    picture: { model: 'seedream/5-lite-image-to-image', field: 'image_urls', array: true, aspect: 'nearest', maxBytes: 30 * MB },
  },
  'qwen/text-to-image': {
    name: 'Qwen Image', note: 'Good with text inside images.',
    sizes: { square: 'square_hd', portrait: 'portrait_4_3', landscape: 'landscape_4_3', wide: 'landscape_16_9' },
    quality: { field: 'num_inference_steps', draft: 20, standard: 30, high: 45 }, safety: 'qwen', extra: { output_format: 'png', acceleration: 'none' },
    picture: { model: 'qwen/image-to-image', field: 'image_url', array: false, aspect: null, strength: true, maxBytes: 10 * MB, estimate: 4 },
  },
  'grok-imagine/text-to-image': {
    name: 'Grok Imagine', note: 'xAI’s image model.', aspects: ['2:3', '3:2', '1:1', '16:9', '9:16'], safety: 'nsfw_checker',
    picture: { model: 'grok-imagine/image-to-image', field: 'image_urls', array: true, aspect: null, maxBytes: 10 * MB, estimate: 4 },
  },
  'nano-banana-2': {
    name: 'Nano Banana 2', note: 'Google’s model; always filtered by Google (no 18+ option).',
    aspects: ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
    quality: { field: 'resolution', draft: '1K', standard: '1K', high: '2K' }, safety: null, extra: { output_format: 'png', image_input: [] },
    picture: { model: 'nano-banana-2', field: 'image_input', array: true, aspect: 'auto', maxBytes: 30 * MB, estimate: 8 },
  },
};
const CUSTOM = { name: 'Custom model', note: 'Sent with prompt, aspect_ratio and nsfw_checker.', aspects: ['1:1', '3:4', '4:3', '16:9'], safety: 'nsfw_checker' };
const PREFER = { square: ['1:1'], portrait: ['2:3', '3:4', '9:16'], landscape: ['3:2', '4:3', '16:9'], wide: ['16:9', '21:9', '3:2', '4:3'] };

const fail = (code, message) => Object.assign(new Error(message), { code });
const modelId = (cfg) => (cfg.model === 'custom' ? cfg.customModel : cfg.model);
const specFor = (cfg) => MODELS[cfg.model] || CUSTOM;
// The environment's key (KIEAI_API_KEY, or KIEAI_API_KEY_FILE: P11-14) wins over a saved one.
const envKey = () => secretFromEnv('KIEAI_API_KEY');
const keyOf = (cfg) => envKey() || cfg.apiKey || '';
// P11-14: said at start when the environment has a key and one is also saved.
function duplicateKeyWarning(cfg = {}) {
  if (!envKey() || !cfg.apiKey) return null;
  return '[imagine] KIEAI_API_KEY is set, and a kie.ai key is also saved in the database (and so in its backups). Remove it in Settings › Image generation › kie.ai ("Forget the saved key")';
}

// The catalogue entry pictures use: the main model's own, else `pictureModel`'s.
function pictureEntry(cfg) {
  if (MODELS[cfg.model]?.picture) return MODELS[cfg.model];
  return MODELS[cfg.pictureModel]?.picture ? MODELS[cfg.pictureModel] : null;
}
// What pictures can do here: { strength } (Qwen's picture model has it), or null.
function pictures(cfg = {}) {
  const entry = pictureEntry(cfg);
  return entry ? { strength: !!entry.picture.strength } : null;
}

// The request body for one generation. A picture request (`request.init`)
// needs `imageUrl`: the picture already uploaded to kie.ai.
function buildInput(request, cfg, { permissive = false, imageUrl = null } = {}) {
  const entry = request.init ? pictureEntry(cfg) : null;
  if (request.init && !entry) throw fail('UNAVAILABLE', 'This kie.ai model can’t start from a picture');
  const spec = entry || specFor(cfg);
  const pic = entry ? entry.picture : null;
  const input = { prompt: request.prompt, ...(spec.extra || {}) };
  if (!pic || pic.aspect === 'nearest') {
    if (spec.sizes) input.image_size = spec.sizes[request.shape] || spec.sizes.square;
    else input.aspect_ratio = (PREFER[request.shape] || PREFER.square).find((a) => spec.aspects.includes(a)) || spec.aspects[0];
  } else if (pic.aspect === 'auto') {
    input.aspect_ratio = 'auto'; // the picture's own proportions
  }
  if (spec.quality) input[spec.quality.field] = spec.quality[request.quality] ?? spec.quality.standard;
  if (spec.safety) input.nsfw_checker = !permissive;
  if (spec.safety === 'qwen') input.enable_safety_checker = !permissive;
  if (pic) {
    input[pic.field] = pic.array ? [imageUrl] : imageUrl;
    if (pic.strength) input.strength = request.init.denoise;
  }
  return { model: pic ? pic.model : modelId(cfg), input };
}

async function kie(path, { method = 'GET', body, form, key, signal, timeoutMs = 20000, base = API() } = {}) {
  const signals = [AbortSignal.timeout(timeoutMs), signal].filter(Boolean);
  let res;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: form || (body ? JSON.stringify(body) : undefined),
      signal: signals.length > 1 ? AbortSignal.any(signals) : signals[0],
    });
  } catch {
    if (signal?.aborted) throw fail('ABORTED', 'Stopped');
    throw fail('UNAVAILABLE', "kie.ai isn't reachable right now");
  }
  const json = await res.json().catch(() => null);
  const code = json && typeof json.code === 'number' ? json.code : res.status;
  if (!res.ok || code !== 200) throw apiError(code, json && json.msg);
  return json.data;
}
function apiError(code, msg) {
  if (code === 401) return fail('UNAVAILABLE', 'kie.ai rejected the API key');
  if (code === 402) return fail('UNAVAILABLE', 'The kie.ai account is out of credits');
  if (code === 429) return fail('UNAVAILABLE', 'kie.ai is limiting requests; try again in a moment');
  return fail('ENGINE', msg ? `kie.ai: ${msg}` : `kie.ai answered ${code}`);
}
const REFUSAL = /nsfw|safety|sensitive|policy|moderat|inappropriate|prohibit|violat/i;

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(fail('ABORTED', 'Stopped'));
    }, { once: true });
  });

// Put one picture in kie.ai's file storage (free; kept 24 hours) and return
// its URL. Base64 up to 10 MB, a file stream above that.
async function uploadPicture(init, key, signal) {
  const ext = init.ext || 'png';
  const fileName = `disgourd-${crypto.randomBytes(8).toString('hex')}.${ext}`;
  const contentType = init.contentType || 'image/png';
  let data;
  if (init.buffer.length <= BASE64_UPLOAD_MAX) {
    data = await kie('/api/file-base64-upload', {
      method: 'POST', key, signal, timeoutMs: 60000, base: UPLOAD_API(),
      body: { base64Data: `data:${contentType};base64,${init.buffer.toString('base64')}`, uploadPath: 'disgourd', fileName },
    });
  } else {
    const form = new FormData();
    form.append('file', new Blob([init.buffer], { type: contentType }), fileName);
    form.append('uploadPath', 'disgourd');
    form.append('fileName', fileName);
    data = await kie('/api/file-stream-upload', { method: 'POST', form, key, signal, timeoutMs: 120000, base: UPLOAD_API() });
  }
  const url = data && data.downloadUrl;
  if (typeof url !== 'string' || !/^https?:\/\//.test(url)) throw fail('ENGINE', 'kie.ai didn’t accept the picture');
  return url;
}

async function generate(request, cfg, { permissive = false, signal } = {}) {
  const key = keyOf(cfg);
  if (!key) throw fail('UNAVAILABLE', 'No kie.ai API key is set');
  let imageUrl = null;
  if (request.init) {
    const entry = pictureEntry(cfg);
    if (!entry) throw fail('UNAVAILABLE', 'This kie.ai model can’t start from a picture');
    if (request.init.buffer.length > entry.picture.maxBytes) {
      throw fail('ENGINE', `That picture is too big for ${entry.name} (${entry.picture.maxBytes / MB} MB at most)`);
    }
    imageUrl = await uploadPicture(request.init, key, signal);
  }
  const body = buildInput(request, cfg, { permissive, imageUrl });
  const created = await kie('/api/v1/jobs/createTask', { method: 'POST', body, key, signal });
  const taskId = created && created.taskId;
  if (!taskId) throw fail('ENGINE', 'kie.ai did not start the task');
  const pollMs = parseInt(process.env.IMAGINE_KIE_POLL_MS, 10) || 2000;
  for (;;) {
    await sleep(pollMs, signal); // on abort this throws; kie.ai has no cancel, so the task may still finish
    const data = await kie(`/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, { key, signal });
    const state = data && data.state;
    if (state === 'fail') {
      const msg = data.failMsg || 'the task failed';
      throw fail(REFUSAL.test(msg) ? 'REFUSED' : 'ENGINE', REFUSAL.test(msg) ? msg : `kie.ai: ${msg}`);
    }
    if (state !== 'success') continue;
    let urls = [];
    try {
      urls = JSON.parse(data.resultJson || '{}').resultUrls || [];
    } catch {
      urls = [];
    }
    if (!urls.length) throw fail('ENGINE', 'kie.ai finished without an image');
    const images = [];
    for (const url of urls) {
      let got;
      try {
        got = await safeFetch(url, { as: 'buffer', types: IMAGE_TYPES, maxBytes: MAX_IMAGE_BYTES, timeoutMs: 60000, allowLoopback: true });
      } catch (err) {
        throw fail('ENGINE', `Couldn't download the image from kie.ai (${err.message})`);
      }
      images.push({ buffer: got.body, contentType: (got.contentType || 'image/png').split(';')[0] });
    }
    return { model: body.model, cost: typeof data.creditsConsumed === 'number' ? data.creditsConsumed : null, images };
  }
}

// The account's credit balance (checks the key too).
async function testKey(key) {
  if (!key) throw fail('UNAVAILABLE', 'No kie.ai API key is set');
  const data = await kie('/api/v1/chat/credit', { key, timeoutMs: 10000 });
  return { credits: typeof data === 'number' ? data : data?.credits ?? null };
}

// The price of one image at `quality`: { credits, estimate } (the last real
// cost recorded, else the catalogue's estimate), or null when unknown.
// A picture job (`picture`) is priced by the picture model.
function priceFor(cfg, quality, { picture = false } = {}) {
  const entry = picture ? pictureEntry(cfg) : null;
  if (picture && !entry) return null;
  const id = entry ? entry.picture.model : modelId(cfg);
  if (!id) return null;
  const last = db.lastImagineCost('kie', id, quality);
  if (last != null) return { credits: last, estimate: false };
  const est = entry ? entry.picture.estimate : specFor(cfg).estimate;
  return est != null ? { credits: est, estimate: true } : null;
}

// ---- Settings ----
function validateConfig(input, prev = {}) {
  const i = input && typeof input === 'object' ? input : {};
  const cfg = { ...prev };
  if (i.enabled !== undefined) cfg.enabled = !!i.enabled;
  if (i.apiKey !== undefined) {
    if (i.apiKey === null) cfg.apiKey = '';
    else if (typeof i.apiKey === 'string' && i.apiKey.trim()) {
      if (i.apiKey.trim().length > 200) return { error: 'That API key is too long' };
      cfg.apiKey = i.apiKey.trim();
    } // an empty string keeps the saved key
  }
  if (i.model !== undefined) {
    if (i.model !== 'custom' && !MODELS[i.model]) return { error: 'Pick a kie.ai model' };
    cfg.model = i.model;
  }
  if (i.customModel !== undefined) cfg.customModel = typeof i.customModel === 'string' ? i.customModel.trim() : '';
  if (i.pictureModel !== undefined) {
    if (i.pictureModel && !MODELS[i.pictureModel]?.picture) return { error: 'Pick a model for pictures' };
    cfg.pictureModel = i.pictureModel || '';
  }
  if (cfg.model === 'custom' && !CUSTOM_ID_RE.test(cfg.customModel || '')) return { error: 'Enter the custom model’s id, e.g. vendor/model-name' };
  if (i.monthlyCredits !== undefined) {
    if (i.monthlyCredits !== null && !(Number.isFinite(i.monthlyCredits) && i.monthlyCredits >= 0 && i.monthlyCredits <= 1e7)) return { error: 'The monthly credit cap must be 0 or more' };
    cfg.monthlyCredits = i.monthlyCredits || null;
  }
  if (cfg.enabled && (!keyOf(cfg) || !cfg.model)) return { error: 'Add an API key and pick a model before turning kie.ai on' };
  return cfg;
}
// What admins see: never the key itself.
function publicConfig(cfg = {}) {
  const saved = cfg.apiKey || '';
  return {
    enabled: !!cfg.enabled,
    model: cfg.model || null,
    customModel: cfg.customModel || '',
    pictureModel: cfg.pictureModel || '',
    pictures: pictures(cfg), // P9-05a: null when this setup can't start from a picture
    monthlyCredits: cfg.monthlyCredits ?? null,
    keySaved: !!saved,
    keyHint: saved ? `••••${saved.slice(-4)}` : null,
    envKey: !!envKey(),
  };
}
// The catalogue for the settings screen, with each model's price.
function catalogue(cfg = {}) {
  return [...Object.entries(MODELS), ['custom', CUSTOM]].map(([id, m]) => ({
    id, name: m.name, note: m.note, filterable: !!m.safety,
    picture: m.picture ? { model: m.picture.model, strength: !!m.picture.strength } : null, // P9-05a
    price: id === 'custom' ? null : priceFor({ ...cfg, model: id }, 'standard'),
  }));
}

module.exports = {
  id: 'kie',
  name: 'kie.ai',
  available: () => true,
  validateConfig,
  publicConfig,
  costOf: (request, cfg) => priceFor(cfg, request.quality, { picture: !!request.init })?.credits || 0,
  pictures,
  uploadPicture,
  priceFor,
  monthlyCap: (cfg) => cfg.monthlyCredits || 0,
  generate,
  testKey,
  keyOf,
  duplicateKeyWarning,
  catalogue,
  buildInput,
  MODELS,
};
