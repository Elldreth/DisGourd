// The kie.ai engine (P2-20c): paid models through kie.ai's one task API.
// POST /api/v1/jobs/createTask { model, input } → poll /api/v1/jobs/recordInfo
// → download the result URLs (through safeFetch: public addresses, images
// only). Each model in the catalogue says how DisGourd's shape and quality map
// onto its inputs, and which content-filter switch it has; a custom model id
// gets the inputs most newer models share. Prices change, so the price shown
// is the last real `creditsConsumed` recorded for that model and quality,
// with the catalogue's estimate only until then.
const db = require('../../db');
const { safeFetch } = require('../../net/safeFetch');

const API = () => (process.env.KIE_API_BASE || 'https://api.kie.ai').replace(/\/+$/, '');
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const CUSTOM_ID_RE = /^[a-z0-9][a-z0-9._/-]{1,100}$/i;

// safety: 'nsfw_checker' (the model's switch), 'qwen' (its checker and the
// switch), or null (no switch: filtered upstream).
const MODELS = {
  'z-image': { name: 'Z-Image', note: 'Fast and inexpensive.', aspects: ['1:1', '4:3', '3:4', '16:9', '9:16'], safety: 'nsfw_checker', estimate: 0.8 },
  'flux-2/pro-text-to-image': {
    name: 'Flux-2 Pro', note: 'High quality; the same family as Flux in ComfyUI.', aspects: ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'],
    quality: { field: 'resolution', draft: '1K', standard: '1K', high: '2K' }, safety: 'nsfw_checker',
  },
  'seedream/5-lite-text-to-image': {
    name: 'Seedream 5.0 Lite', note: 'Detailed 2K images (3K at High).', aspects: ['1:1', '4:3', '3:4', '16:9', '9:16', '2:3', '3:2', '21:9'],
    quality: { field: 'quality', draft: 'basic', standard: 'basic', high: 'high' }, safety: 'nsfw_checker', extra: { output_format: 'png' },
  },
  'qwen/text-to-image': {
    name: 'Qwen Image', note: 'Good with text inside images.',
    sizes: { square: 'square_hd', portrait: 'portrait_4_3', landscape: 'landscape_4_3', wide: 'landscape_16_9' },
    quality: { field: 'num_inference_steps', draft: 20, standard: 30, high: 45 }, safety: 'qwen', extra: { output_format: 'png', acceleration: 'none' },
  },
  'grok-imagine/text-to-image': { name: 'Grok Imagine', note: 'xAI’s image model.', aspects: ['2:3', '3:2', '1:1', '16:9', '9:16'], safety: 'nsfw_checker' },
  'nano-banana-2': {
    name: 'Nano Banana 2', note: 'Google’s model; always filtered by Google (no 18+ option).',
    aspects: ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
    quality: { field: 'resolution', draft: '1K', standard: '1K', high: '2K' }, safety: null, extra: { output_format: 'png', image_input: [] },
  },
};
const CUSTOM = { name: 'Custom model', note: 'Sent with prompt, aspect_ratio and nsfw_checker.', aspects: ['1:1', '3:4', '4:3', '16:9'], safety: 'nsfw_checker' };
const PREFER = { square: ['1:1'], portrait: ['2:3', '3:4', '9:16'], landscape: ['3:2', '4:3', '16:9'], wide: ['16:9', '21:9', '3:2', '4:3'] };

const fail = (code, message) => Object.assign(new Error(message), { code });
const modelId = (cfg) => (cfg.model === 'custom' ? cfg.customModel : cfg.model);
const specFor = (cfg) => MODELS[cfg.model] || CUSTOM;
const keyOf = (cfg) => process.env.KIEAI_API_KEY || cfg.apiKey || '';

// The request body for one generation.
function buildInput(request, cfg, { permissive = false } = {}) {
  const spec = specFor(cfg);
  const input = { prompt: request.prompt, ...(spec.extra || {}) };
  if (spec.sizes) input.image_size = spec.sizes[request.shape] || spec.sizes.square;
  else input.aspect_ratio = (PREFER[request.shape] || PREFER.square).find((a) => spec.aspects.includes(a)) || spec.aspects[0];
  if (spec.quality) input[spec.quality.field] = spec.quality[request.quality] ?? spec.quality.standard;
  if (spec.safety) input.nsfw_checker = !permissive;
  if (spec.safety === 'qwen') input.enable_safety_checker = !permissive;
  return { model: modelId(cfg), input };
}

async function kie(path, { method = 'GET', body, key, signal, timeoutMs = 20000 } = {}) {
  const signals = [AbortSignal.timeout(timeoutMs), signal].filter(Boolean);
  let res;
  try {
    res = await fetch(`${API()}${path}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
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

async function generate(request, cfg, { permissive = false, signal } = {}) {
  const key = keyOf(cfg);
  if (!key) throw fail('UNAVAILABLE', 'No kie.ai API key is set');
  const body = buildInput(request, cfg, { permissive });
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
function priceFor(cfg, quality) {
  const id = modelId(cfg);
  if (!id) return null;
  const last = db.lastImagineCost('kie', id, quality);
  if (last != null) return { credits: last, estimate: false };
  const est = specFor(cfg).estimate;
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
    monthlyCredits: cfg.monthlyCredits ?? null,
    keySaved: !!saved,
    keyHint: saved ? `••••${saved.slice(-4)}` : null,
    envKey: !!process.env.KIEAI_API_KEY,
  };
}
// The catalogue for the settings screen, with each model's price.
function catalogue(cfg = {}) {
  return [...Object.entries(MODELS), ['custom', CUSTOM]].map(([id, m]) => ({
    id, name: m.name, note: m.note, filterable: !!m.safety,
    price: id === 'custom' ? null : priceFor({ ...cfg, model: id }, 'standard'),
  }));
}

module.exports = {
  id: 'kie',
  name: 'kie.ai',
  available: () => true,
  validateConfig,
  publicConfig,
  costOf: (request, cfg) => priceFor(cfg, request.quality)?.credits || 0,
  priceFor,
  monthlyCap: (cfg) => cfg.monthlyCredits || 0,
  generate,
  testKey,
  keyOf,
  catalogue,
  buildInput,
  MODELS,
};
