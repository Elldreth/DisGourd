// The ComfyUI engine (P2-20b): a local ComfyUI server the site admin points
// at. DisGourd builds an API-format workflow for the chosen checkpoint's
// family (SD 1.5, SDXL or Flux), queues it with POST /prompt, waits on
// /history and fetches the image with /view. Images go through PreviewImage
// (ComfyUI's temp folder), so nothing piles up in its output folder.
//
// The address is set by site admins only, so it may be on the LAN and is
// called directly (not through safeFetch, which refuses private addresses).
// ComfyUI has no content filter: outside 18+ channels SD 1.5 / SDXL get a
// negative-prompt nudge, which is not a filter (Flux at CFG 1 ignores it).
const crypto = require('crypto');

const FAMILIES = {
  sd15: { name: 'SD 1.5', mp: { draft: 0.26, standard: 0.33, high: 0.45 }, steps: { draft: 16, standard: 26, high: 34 }, cfg: 7, sampler: 'dpmpp_2m', scheduler: 'karras' },
  sdxl: { name: 'SDXL', mp: { draft: 0.8, standard: 1.0, high: 1.15 }, steps: { draft: 18, standard: 28, high: 36 }, cfg: 6, sampler: 'dpmpp_2m', scheduler: 'karras' },
  flux: { name: 'Flux', mp: { draft: 0.6, standard: 1.0, high: 1.6 }, steps: { draft: 12, standard: 20, high: 28 }, cfg: 1, guidance: 3.5, sampler: 'euler', scheduler: 'simple' },
};
// The most pixels each VRAM tier is asked for (megapixels).
const TIERS = { low: 1.0, medium: 1.5, high: 2.4 };
const RATIOS = { square: [1, 1], portrait: [2, 3], landscape: [3, 2], wide: [16, 9] };
const NEGATIVE = 'lowres, worst quality, low quality, blurry, jpeg artifacts, watermark, signature, text';
const SAFE_NEGATIVE = 'nsfw, nude, nudity';
const SAVE_NODE = '9';

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
  const family = FAMILIES[cfg.family] ? cfg.family : 'sdxl';
  const f = FAMILIES[family];
  const { width, height } = sizeFor(family, request.quality, request.shape, cfg.tier);
  const negative = family === 'flux' ? '' : permissive ? NEGATIVE : `${NEGATIVE}, ${SAFE_NEGATIVE}`;
  const wf = {
    4: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: cfg.model } },
    5: { class_type: family === 'flux' ? 'EmptySD3LatentImage' : 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } },
    6: { class_type: 'CLIPTextEncode', inputs: { text: request.prompt, clip: ['4', 1] } },
    7: { class_type: 'CLIPTextEncode', inputs: { text: negative, clip: ['4', 1] } },
    3: {
      class_type: 'KSampler',
      inputs: {
        seed, steps: f.steps[request.quality] || f.steps.standard, cfg: f.cfg, sampler_name: f.sampler, scheduler: f.scheduler, denoise: 1,
        model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0],
      },
    },
    8: { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    [SAVE_NODE]: { class_type: 'PreviewImage', inputs: { images: ['8', 0] } },
  };
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

// The checkpoints ComfyUI can load: [{ name, family }].
async function listModels(url) {
  const data = await comfy(url, '/object_info/CheckpointLoaderSimple', { timeoutMs: 8000 });
  const names = data?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0];
  if (!Array.isArray(names)) throw fail('ENGINE', 'That address answered, but not like ComfyUI');
  return names.map((name) => ({ name, family: guessFamily(name) }));
}

// A /prompt refusal in plain words.
function promptError(err, cfg) {
  const nodeErrors = err.data && err.data.node_errors ? Object.values(err.data.node_errors) : [];
  const all = nodeErrors.flatMap((n) => n.errors || []);
  if (all.some((e) => /ckpt_name/.test(`${e.details || ''} ${e.message || ''}`))) return fail('ENGINE', `The model "${cfg.model}" isn't in ComfyUI any more`);
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
  if (i.model !== undefined) {
    if (i.model !== null && (typeof i.model !== 'string' || !i.model.trim() || i.model.length > 300)) return { error: 'Pick a model' };
    cfg.model = i.model;
    if (i.family === undefined && i.model) cfg.family = guessFamily(i.model);
  }
  if (i.family !== undefined) {
    if (!FAMILIES[i.family]) return { error: 'The model type must be SD 1.5, SDXL or Flux' };
    cfg.family = i.family;
  }
  if (i.tier !== undefined) {
    if (!TIERS[i.tier]) return { error: 'The VRAM tier must be low, medium or high' };
    cfg.tier = i.tier;
  }
  cfg.tier = cfg.tier || 'medium';
  cfg.family = cfg.family || (cfg.model ? guessFamily(cfg.model) : 'sdxl');
  if (cfg.enabled && (!cfg.url || !cfg.model)) return { error: 'Set the ComfyUI address and pick a model before turning it on' };
  return cfg;
}
const publicConfig = (cfg = {}) => ({
  enabled: !!cfg.enabled, url: cfg.url || '', model: cfg.model || null, family: cfg.family || null, tier: cfg.tier || 'medium',
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
  guessFamily,
  sizeFor,
  buildWorkflow,
  FAMILIES,
  TIERS,
};
