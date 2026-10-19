// P2-20b: the ComfyUI engine against a mock ComfyUI server, and the admin
// routes that set it up (test connection, test image).
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

let serverModule;
let db;
let comfy;
let port;
let mock;
let mockUrl;
const UPLOADS = path.join(os.tmpdir(), `disgourd-test-uploads-comfy-${process.pid}`);
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108020000009077' + '53de0000000c4944415408d763f8cfc0000003010100c9fe92ef0000000049454e44ae426082', 'hex');
const MODELS = [String.raw`Flux\flux1-dev-fp8.safetensors`, String.raw`Illustrious\Illustrious-XL-v2.0.safetensors`, String.raw`SD1\absolutereality_v16.safetensors`];
// Separate-part models (P3-24), in the newer ['COMBO', { options }] form.
const UNETS = ['flux1-dev-fp8.safetensors', String.raw`zturbo\z_image_turbo_bf16.safetensors`, 'krea2_turbo.safetensors', String.raw`hunyuan_video\t2v_720p.safetensors`];
const CLIPS = ['clip_l.safetensors', 't5xxl_enconly.safetensors', String.raw`zturbo\qwen_3_4b.safetensors`];
const VAES = [String.raw`FLUX1\ae.sft`, String.raw`zturbo\ae.safetensors`, String.raw`SDXL\sdxl_vae.safetensors`];
const UPSCALERS = ['4x-AnimeSharp.pth', '4x-UltraSharp.pth', 'RealESRGAN_x2.pth'];
let partsListed = true; // false: this ComfyUI can't list split parts

// What the mock saw.
const seen = { prompts: [], deleted: [], interrupts: 0, uploads: [] };
let hasTiled = true; // whether the mock has the Ultimate SD Upscale node
const SAMPLERS = ['euler', 'dpmpp_2m', 'dpmpp_2m_sde'];
const SCHEDULERS = ['simple', 'karras', 'exponential'];
const DETECTORS = ['bbox/hand_yolov8n.pt', 'bbox/face_yolov8n.pt', 'bbox/face_yolov8m.pt'];
let promptCount = 0;
const promptsById = new Map();

function startMock() {
  mock = http.createServer((req, res) => {
    let body = '';
    req.setEncoding('latin1');
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const json = (status, data) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(data));
      };
      const url = new URL(req.url, 'http://x');
      if (url.pathname === '/object_info/CheckpointLoaderSimple') return json(200, { CheckpointLoaderSimple: { input: { required: { ckpt_name: [MODELS] } } } });
      const combo = (node, input, list) => json(200, partsListed ? { [node]: { input: { required: { [input]: ['COMBO', { options: list }] } } } } : {});
      if (url.pathname === '/object_info/UNETLoader') return combo('UNETLoader', 'unet_name', UNETS);
      if (url.pathname === '/object_info/CLIPLoader') return combo('CLIPLoader', 'clip_name', CLIPS);
      if (url.pathname === '/object_info/VAELoader') return combo('VAELoader', 'vae_name', VAES);
      if (url.pathname === '/object_info/UpscaleModelLoader') return combo('UpscaleModelLoader', 'model_name', UPSCALERS);
      if (url.pathname === '/object_info/KSampler') {
        return json(200, partsListed ? { KSampler: { input: { required: { sampler_name: [SAMPLERS], scheduler: [SCHEDULERS] } } } } : {});
      }
      if (url.pathname === '/object_info/UltralyticsDetectorProvider') return combo('UltralyticsDetectorProvider', 'model_name', DETECTORS);
      if (url.pathname === '/object_info/UltimateSDUpscaleNoUpscale') return json(200, hasTiled ? { UltimateSDUpscaleNoUpscale: { input: { required: {} } } } : {});
      if (url.pathname === '/object_info/FaceDetailer') return json(200, hasTiled ? { FaceDetailer: { input: { required: {} } } } : {});
      if (url.pathname === '/object_info/UltimateSDUpscale') return json(200, hasTiled ? { UltimateSDUpscale: { input: { required: {} } } } : {});
      if (url.pathname === '/upload/image' && req.method === 'POST') {
        const name = (body.match(/filename="([^"]+)"/) || [])[1];
        seen.uploads.push({ name, type: (req.headers['content-type'] || '').split(';')[0], overwrite: /name="overwrite"\r\n\r\ntrue/.test(body) });
        return json(200, { name, subfolder: '', type: 'input' });
      }
      if (url.pathname === '/prompt' && req.method === 'POST') {
        const { prompt } = JSON.parse(body);
        seen.prompts.push(prompt);
        if (prompt['40']?.inputs.model_name === 'gone.pt') {
          return json(400, { error: { message: 'Prompt outputs failed validation' }, node_errors: { 40: { errors: [{ message: 'Value not in list', details: "model_name: 'gone.pt' not in [...]" }] } } });
        }
        if (prompt['3']?.inputs.sampler_name === 'made_up') {
          return json(400, { error: { message: 'Prompt outputs failed validation' }, node_errors: { 3: { errors: [{ message: 'Value not in list', details: "sampler_name: 'made_up' not in [...]" }] } } });
        }
        if (prompt['20']?.inputs.model_name === 'gone.pth') {
          return json(400, { error: { message: 'Prompt outputs failed validation' }, node_errors: { 20: { errors: [{ message: 'Value not in list', details: "model_name: 'gone.pth' not in [...]" }] } } });
        }
        if (prompt['13']?.inputs.vae_name === 'gone.sft') {
          return json(400, { error: { message: 'Prompt outputs failed validation' }, node_errors: { 13: { errors: [{ message: 'Value not in list', details: "vae_name: 'gone.sft' not in [...]" }] } } });
        }
        if (prompt['4']?.inputs.ckpt_name === 'missing.safetensors') {
          return json(400, { error: { message: 'Prompt outputs failed validation' }, node_errors: { 4: { errors: [{ message: 'Value not in list', details: "ckpt_name: 'missing.safetensors' not in [...]" }] } } });
        }
        const id = `p${++promptCount}`;
        promptsById.set(id, { text: prompt['6']?.inputs.text || 'upscale', polls: 0 });
        return json(200, { prompt_id: id, number: promptCount });
      }
      if (url.pathname.startsWith('/history/')) {
        const id = decodeURIComponent(url.pathname.slice(9));
        const p = promptsById.get(id);
        if (!p) return json(200, {});
        p.polls += 1;
        if (p.text.includes('[slow]') || p.text.includes('[queued]') || p.polls < 2) return json(200, {}); // not done yet
        if (p.text.includes('[boom]')) return json(200, { [id]: { status: { status_str: 'error', completed: false, messages: [['execution_error', { exception_message: 'CUDA out of memory' }]] }, outputs: {} } });
        return json(200, { [id]: { status: { status_str: 'success', completed: true }, outputs: { 9: { images: [{ filename: 'ComfyUI_temp_1.png', subfolder: '', type: 'temp' }] } } } });
      }
      if (url.pathname === '/view') {
        res.writeHead(200, { 'content-type': 'image/png' });
        return res.end(PNG);
      }
      if (url.pathname === '/queue' && req.method === 'GET') {
        const running = [...promptsById].filter(([, p]) => p.text.includes('[slow]')).map(([id]) => [0, id]);
        const pending = [...promptsById].filter(([, p]) => p.text.includes('[queued]')).map(([id]) => [1, id]);
        return json(200, { queue_running: running, queue_pending: pending });
      }
      if (url.pathname === '/queue' && req.method === 'POST') {
        seen.deleted.push(...(JSON.parse(body).delete || []));
        return json(200, {});
      }
      if (url.pathname === '/interrupt') {
        seen.interrupts += 1;
        return json(200, {});
      }
      json(404, {});
    });
  });
  return new Promise((r) => mock.listen(0, '127.0.0.1', () => r()));
}

beforeAll(async () => {
  process.env.PORT = 0;
  process.env.JWT_SECRET = 'disgourd-test-secret-0123456789abcdef';
  process.env.DB_PATH = ':memory:';
  process.env.UPLOADS_DIR = UPLOADS;
  process.env.IMAGINE_COMFY_POLL_MS = '20';
  await startMock();
  mockUrl = `http://127.0.0.1:${mock.address().port}`;
  serverModule = require('../server');
  db = serverModule.db;
  comfy = require('../imagine/engines/comfyui');
  await new Promise((r) => serverModule.httpServer.listen(0, r));
  port = serverModule.httpServer.address().port;
});
afterAll(async () => {
  await new Promise((r) => serverModule.httpServer.close(r));
  await new Promise((r) => mock.close(r));
});

const cfg = (over = {}) => ({ url: mockUrl, model: MODELS[1], family: 'sdxl', tier: 'high', ...over });
const request = (over = {}) => ({ prompt: 'a gourd in a hat', shape: 'square', quality: 'standard', ...over });

describe('the engine', () => {
  test('lists the checkpoints with a guessed type', async () => {
    expect((await comfy.listModels(mockUrl)).filter((m) => m.kind === 'checkpoint')).toEqual([
      { name: MODELS[0], kind: 'checkpoint', family: 'flux' },
      { name: MODELS[1], kind: 'checkpoint', family: 'sdxl' },
      { name: MODELS[2], kind: 'checkpoint', family: 'sd15' },
    ]);
  });

  test('P3-24: lists image diffusion models (not video ones) with suggested parts, and the encoders and VAEs', async () => {
    const all = await comfy.listAll(mockUrl);
    expect(all.clips).toEqual(CLIPS);
    expect(all.vaes).toEqual(VAES);
    expect(all.models.filter((m) => m.kind === 'unet')).toEqual([
      { name: UNETS[0], kind: 'unet', family: 'flux' },
      { name: UNETS[1], kind: 'unet', family: 'zimage' },
      { name: UNETS[2], kind: 'unet', family: null }, // the host picks its type
    ]);
    expect(all.suggested).toEqual({
      flux: { clip1: 'clip_l.safetensors', clip2: 't5xxl_enconly.safetensors', vae: String.raw`FLUX1\ae.sft` },
      zimage: { clip1: String.raw`zturbo\qwen_3_4b.safetensors`, clip2: null, vae: String.raw`zturbo\ae.safetensors` },
      upscaler: '4x-UltraSharp.pth', // P3-28: a general-purpose one, not the anime one listed first
      detector: 'bbox/face_yolov8m.pt', // P3-31: the medium face model, not the hand one listed first
    });
    expect(all).toMatchObject({ samplers: SAMPLERS, schedulers: SCHEDULERS, detectors: DETECTORS, detailerAvailable: true, tiledPassesAvailable: true });
    expect(all.upscalers).toEqual(UPSCALERS);
    expect(all.tiledAvailable).toBe(true); // P3-29
    // Another host's ComfyUI that can't list split parts: checkpoints only.
    partsListed = false;
    try {
      const old = await comfy.listAll(mockUrl);
      hasTiled = false;
      expect(old).toMatchObject({ models: MODELS.map((name) => ({ name, kind: 'checkpoint' })), clips: [], vaes: [], upscalers: [], suggested: { upscaler: null } });
      expect(await comfy.listAll(mockUrl)).toMatchObject({ tiledAvailable: false, samplers: [], schedulers: [], detectors: [], detailerAvailable: false, suggested: { detector: null } });
    } finally {
      partsListed = true;
      hasTiled = true;
    }
  });

  test('P3-24: a Flux model in parts loads UNET + two text encoders + VAE; Z-Image adds AuraFlow sampling', () => {
    const flux = comfy.buildWorkflow(request({ quality: 'high' }), cfg({ kind: 'unet', model: UNETS[0], family: 'flux', clip1: CLIPS[0], clip2: CLIPS[1], vae: VAES[0] })).workflow;
    expect(flux['4']).toBeUndefined();
    expect(flux['11']).toEqual({ class_type: 'UNETLoader', inputs: { unet_name: UNETS[0], weight_dtype: 'default' } });
    expect(flux['12']).toEqual({ class_type: 'DualCLIPLoader', inputs: { clip_name1: CLIPS[0], clip_name2: CLIPS[1], type: 'flux' } });
    expect(flux['13']).toEqual({ class_type: 'VAELoader', inputs: { vae_name: VAES[0] } });
    expect(flux['6'].inputs.clip).toEqual(['12', 0]);
    expect(flux['8'].inputs.vae).toEqual(['13', 0]);
    expect(flux['3'].inputs).toMatchObject({ model: ['11', 0], positive: ['10', 0], cfg: 1, steps: 28 });
    expect(flux['10'].class_type).toBe('FluxGuidance');
    const z = comfy.buildWorkflow(request({ quality: 'standard' }), cfg({ kind: 'unet', model: UNETS[1], family: 'zimage', clip1: CLIPS[2], vae: VAES[1] })).workflow;
    expect(z['12']).toEqual({ class_type: 'CLIPLoader', inputs: { clip_name: CLIPS[2], type: 'lumina2' } });
    expect(z['14']).toEqual({ class_type: 'ModelSamplingAuraFlow', inputs: { model: ['11', 0], shift: 3 } });
    expect(z['3'].inputs).toMatchObject({ model: ['14', 0], positive: ['6', 0], cfg: 1, steps: 8, sampler_name: 'res_multistep', scheduler: 'simple' });
    expect(z['5'].class_type).toBe('EmptySD3LatentImage');
    expect(z['10']).toBeUndefined();
    expect(z['7'].inputs.text).toBe('');
    // Checkpoints are unchanged.
    expect(comfy.buildWorkflow(request(), cfg()).workflow['4'].class_type).toBe('CheckpointLoaderSimple');
  });

  test('P3-24: a split model generates end to end; a missing VAE is explained', async () => {
    const out = await comfy.generate(request(), cfg({ kind: 'unet', model: UNETS[1], family: 'zimage', clip1: CLIPS[2], vae: VAES[1] }));
    expect(out.images[0].buffer.equals(PNG)).toBe(true);
    expect(seen.prompts.at(-1)['11'].inputs.unet_name).toBe(UNETS[1]);
    await expect(comfy.generate(request(), cfg({ kind: 'unet', model: UNETS[1], family: 'zimage', clip1: CLIPS[2], vae: 'gone.sft' }))).rejects.toMatchObject({ message: 'The VAE "gone.sft" isn\'t in ComfyUI any more' });
  });

  test('P3-28: the hires fix at High quality: Standard-size first pass, upscale model, exact size, light repaint', () => {
    const on = cfg({ upscaler: '4x-UltraSharp.pth', tier: 'medium' });
    const { workflow: wf, width, height, hires } = comfy.buildWorkflow(request({ quality: 'high' }), on, { seed: 7 });
    expect(hires).toBe(true);
    expect(wf['5'].inputs).toMatchObject({ width: 1024, height: 1024 }); // the Standard size
    expect([width, height]).toEqual([1536, 1536]);
    expect(wf['20']).toEqual({ class_type: 'UpscaleModelLoader', inputs: { model_name: '4x-UltraSharp.pth' } });
    expect(wf['21']).toEqual({ class_type: 'ImageUpscaleWithModel', inputs: { upscale_model: ['20', 0], image: ['8', 0] } });
    expect(wf['22']).toEqual({ class_type: 'ImageScale', inputs: { image: ['21', 0], upscale_method: 'lanczos', width: 1536, height: 1536, crop: 'disabled' } });
    expect(wf['23']).toEqual({ class_type: 'VAEEncode', inputs: { pixels: ['22', 0], vae: ['4', 2] } });
    expect(wf['24'].inputs).toMatchObject({ seed: 7, denoise: 0.4, steps: 28, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['23', 0] });
    expect(wf['3'].inputs.steps).toBe(36); // the first pass keeps High's steps
    expect(wf['9'].inputs.images).toEqual(['25', 0]);
    // Flux in parts: the repaint uses the same guidance and loaders.
    const flux = comfy.buildWorkflow(request({ quality: 'high' }), cfg({ kind: 'unet', model: UNETS[0], family: 'flux', clip1: CLIPS[0], clip2: CLIPS[1], vae: VAES[0], upscaler: 'x.pth' })).workflow;
    expect(flux['24'].inputs).toMatchObject({ model: ['11', 0], positive: ['10', 0], cfg: 1 });
    expect(flux['23'].inputs.vae).toEqual(['13', 0]);
    // Not applied: Standard quality, switched off, or no upscale model.
    for (const [req, c] of [[request({ quality: 'standard' }), on], [request({ quality: 'high' }), { ...on, hires: false }], [request({ quality: 'high' }), cfg()]]) {
      const out = comfy.buildWorkflow(req, c);
      expect(out.hires).toBe(false);
      expect(out.workflow['20']).toBeUndefined();
      expect(out.workflow['9'].inputs.images).toEqual(['8', 0]);
    }
    // Each tier stays within its hires budget (10% rounding allowance).
    for (const tier of ['low', 'medium', 'high']) {
      for (const shape of ['square', 'portrait', 'landscape', 'wide']) {
        const out = comfy.buildWorkflow(request({ quality: 'high', shape }), { ...on, tier });
        expect(out.width % 64 + out.height % 64).toBe(0);
        expect(out.width * out.height).toBeLessThanOrEqual(comfy.HIRES_MP[tier] * 1e6 * 1.1);
      }
    }
  });

  test('P3-28: a hires generation runs end to end; a missing upscale model is explained; config round-trips', async () => {
    const out = await comfy.generate(request({ quality: 'high' }), cfg({ upscaler: '4x-UltraSharp.pth', tier: 'high' }));
    expect(out).toMatchObject({ width: 1536, height: 1536 });
    expect(seen.prompts.at(-1)['20'].inputs.model_name).toBe('4x-UltraSharp.pth');
    await expect(comfy.generate(request({ quality: 'high' }), cfg({ upscaler: 'gone.pth' }))).rejects.toMatchObject({ message: 'The upscale model "gone.pth" isn\'t in ComfyUI any more' });
    expect(comfy.validateConfig({ upscaler: 5 }).error).toMatch(/upscale model/);
    expect(comfy.validateConfig({ hires: false, upscaler: '4x-UltraSharp.pth' })).toMatchObject({ hires: false, upscaler: '4x-UltraSharp.pth' });
    expect(comfy.publicConfig({})).toMatchObject({ hires: true, upscaler: null }); // on unless switched off
  });

  test('P3-29 fix: the hires fix works with no saved upscale model (suggested from the list, then cached)', async () => {
    comfy.upscalerCache.clear();
    const before = seen.prompts.length;
    const out = await comfy.generate(request({ quality: 'high' }), cfg({ upscaler: undefined, tier: 'high' }));
    expect(out).toMatchObject({ width: 1536, height: 1536 });
    expect(seen.prompts.at(-1)['20'].inputs.model_name).toBe('4x-UltraSharp.pth');
    expect(seen.prompts.length).toBe(before + 1);
    expect(comfy.upscalerCache.get(mockUrl)).toMatchObject({ name: '4x-UltraSharp.pth' });
    expect(await comfy.resolveUpscaler(cfg({ upscaler: 'mine.pth' }))).toBe('mine.pth'); // a saved one wins
    // Switched off: no upscale model is looked for or used.
    expect((await comfy.generate(request({ quality: 'high' }), cfg({ hires: false }))).width).toBe(1088); // High's own size, no fix
    expect(seen.prompts.at(-1)['20']).toBeUndefined();
  });

  test('P3-29: Upscale workflows: model only (exact 2× size) and tiled (Ultimate SD Upscale with the configured model)', () => {
    const up = { upscale: { width: 1536, height: 1024, factor: 2 } };
    const plain = comfy.buildUpscaleWorkflow(request(up), cfg({ upscaler: '4x-UltraSharp.pth' }), 'in.png');
    expect([plain.width, plain.height]).toEqual([3072, 2048]);
    expect(plain.workflow).toEqual({
      1: { class_type: 'LoadImage', inputs: { image: 'in.png' } },
      20: { class_type: 'UpscaleModelLoader', inputs: { model_name: '4x-UltraSharp.pth' } },
      21: { class_type: 'ImageUpscaleWithModel', inputs: { upscale_model: ['20', 0], image: ['1', 0] } },
      22: { class_type: 'ImageScale', inputs: { image: ['21', 0], upscale_method: 'lanczos', width: 3072, height: 2048, crop: 'disabled' } },
      9: { class_type: 'PreviewImage', inputs: { images: ['22', 0] } },
    });
    const tiled = comfy.buildUpscaleWorkflow(request(up), cfg({ upscaler: 'u.pth', upscaleMode: 'tiled', tileDenoise: 0.25, tileSize: 768 }), 'in.png', { seed: 5 }).workflow;
    expect(tiled['30'].class_type).toBe('UltimateSDUpscale');
    expect(tiled['30'].inputs).toMatchObject({
      image: ['1', 0], model: ['4', 0], positive: ['6', 0], negative: ['7', 0], vae: ['4', 2], upscale_model: ['20', 0],
      upscale_by: 2, seed: 5, steps: 28, cfg: 6, sampler_name: 'dpmpp_2m', scheduler: 'karras', denoise: 0.25, tile_width: 768, tile_height: 768, mode_type: 'Linear', seam_fix_mode: 'None',
    });
    expect(tiled['3'] || tiled['5'] || tiled['8']).toBeUndefined(); // no KSampler, latent or decode of its own
    expect(tiled['9'].inputs.images).toEqual(['30', 0]);
    expect(tiled['7'].inputs.text).toMatch(/nsfw/); // the negative nudge still applies outside 18+
    // Flux in parts: its loaders, guidance and VAE; default denoise and tile size.
    const flux = comfy.buildUpscaleWorkflow(request(up), cfg({ kind: 'unet', model: UNETS[0], family: 'flux', clip1: CLIPS[0], clip2: CLIPS[1], vae: VAES[0], upscaler: 'u.pth', upscaleMode: 'tiled' }), 'in.png').workflow;
    expect(flux['30'].inputs).toMatchObject({ model: ['11', 0], positive: ['10', 0], vae: ['13', 0], cfg: 1, steps: 20, denoise: 0.3, tile_width: 1024 });
  });

  test('P3-29: Upscale config: mode, denoise and tile size are checked', () => {
    expect(comfy.validateConfig({ upscaleMode: 'huge' }).error).toMatch(/upscale mode/);
    expect(comfy.validateConfig({ tileDenoise: 0.9 }).error).toMatch(/0.05–0.6/);
    expect(comfy.validateConfig({ tileSize: 1000 }).error).toMatch(/steps of 64/);
    expect(comfy.validateConfig({ upscaleMode: 'tiled', tileDenoise: 0.35, tileSize: 1536 })).toMatchObject({ upscaleMode: 'tiled', tileDenoise: 0.35, tileSize: 1536 });
    expect(comfy.publicConfig({})).toMatchObject({ upscaleMode: 'model', tileDenoise: 0.3, tileSize: 1024 });
  });

  test('P3-31: advanced sampler, scheduler, CFG and steps reach every sampling node; blanks keep the defaults', () => {
    const adv = cfg({ sampler: 'dpmpp_2m_sde', scheduler: 'exponential', cfgScale: 4.5, steps: { draft: 9, standard: 22, high: 40 }, upscaler: 'u.pth', tier: 'high' });
    const high = comfy.buildWorkflow(request({ quality: 'high' }), adv).workflow;
    expect(high['3'].inputs).toMatchObject({ sampler_name: 'dpmpp_2m_sde', scheduler: 'exponential', cfg: 4.5, steps: 40 });
    expect(high['24'].inputs).toMatchObject({ sampler_name: 'dpmpp_2m_sde', scheduler: 'exponential', cfg: 4.5, steps: 22 }); // the hires repaint: Standard's steps
    expect(comfy.buildWorkflow(request({ quality: 'draft' }), adv).workflow['3'].inputs.steps).toBe(9);
    const tiled = comfy.buildUpscaleWorkflow(request({ upscale: { width: 512, height: 512, factor: 2 } }), { ...adv, upscaleMode: 'tiled' }, 'in.png').workflow;
    expect(tiled['30'].inputs).toMatchObject({ sampler_name: 'dpmpp_2m_sde', scheduler: 'exponential', cfg: 4.5, steps: 22 });
    // Blank: the model type's tuned defaults; a partial steps object fills the rest.
    expect(comfy.buildWorkflow(request(), cfg()).workflow['3'].inputs).toMatchObject({ sampler_name: 'dpmpp_2m', scheduler: 'karras', cfg: 6, steps: 28 });
    expect(comfy.buildWorkflow(request({ quality: 'high' }), cfg({ steps: { draft: 5 } })).workflow['3'].inputs.steps).toBe(36);
    expect(comfy.buildWorkflow(request(), cfg({ model: MODELS[0], family: 'flux' })).workflow['3'].inputs).toMatchObject({ sampler_name: 'euler', cfg: 1 });
  });

  test('P3-31: the negative prompt: the host’s replaces the built-in one; safety words stay outside 18+; Flux only if set', () => {
    const neg = (c, permissive = false) => comfy.buildWorkflow(request(), cfg(c), { permissive }).workflow['7'].inputs.text;
    expect(neg({ negative: 'ugly, extra fingers' })).toBe('ugly, extra fingers, nsfw, nude, nudity');
    expect(neg({ negative: 'ugly, extra fingers' }, true)).toBe('ugly, extra fingers');
    expect(neg({})).toMatch(/^lowres, worst quality.*nsfw, nude, nudity$/);
    expect(neg({ model: MODELS[0], family: 'flux' })).toBe('');
    expect(neg({ model: MODELS[0], family: 'flux', negative: 'blurry' })).toBe('blurry');
  });

  test('P3-31: the face detailer on Standard and High (after the hires fix), not Draft, off or without a detector', () => {
    const on = cfg({ detailer: true, detector: 'bbox/face_yolov8m.pt', detailerDenoise: 0.35, sampler: 'euler', upscaler: 'u.pth', tier: 'high' });
    const std = comfy.buildWorkflow(request(), on, { seed: 3 });
    expect(std.detailer).toBe(true);
    expect(std.workflow['40']).toEqual({ class_type: 'UltralyticsDetectorProvider', inputs: { model_name: 'bbox/face_yolov8m.pt' } });
    expect(std.workflow['41']).toMatchObject({
      class_type: 'FaceDetailer',
      inputs: {
        image: ['8', 0], model: ['4', 0], clip: ['4', 1], vae: ['4', 2], positive: ['6', 0], negative: ['7', 0], bbox_detector: ['40', 0],
        seed: 3, steps: 28, cfg: 6, sampler_name: 'euler', scheduler: 'karras', denoise: 0.35, guide_size: 1024, max_size: 1024, sam_mask_hint_use_negative: 'False', cycle: 1,
      },
    });
    expect(std.workflow['9'].inputs.images).toEqual(['41', 0]);
    const high = comfy.buildWorkflow(request({ quality: 'high' }), on).workflow;
    expect(high['41'].inputs.image).toEqual(['25', 0]); // after the hires repaint
    // Flux in parts: its own loaders and guidance; SD 1.5 guides at 512.
    const flux = comfy.buildWorkflow(request(), cfg({ kind: 'unet', model: UNETS[0], family: 'flux', clip1: CLIPS[0], clip2: CLIPS[1], vae: VAES[0], detailer: true, detector: 'd.pt' })).workflow;
    expect(flux['41'].inputs).toMatchObject({ model: ['11', 0], clip: ['12', 0], vae: ['13', 0], positive: ['10', 0], cfg: 1 });
    expect(comfy.buildWorkflow(request(), cfg({ family: 'sd15', detailer: true, detector: 'd.pt' })).workflow['41'].inputs.guide_size).toBe(512);
    for (const [req, c] of [[request({ quality: 'draft' }), on], [request(), { ...on, detailer: false }], [request(), { ...on, detector: null }]]) {
      const out = comfy.buildWorkflow(req, c);
      expect(out.detailer).toBe(false);
      expect(out.workflow['41']).toBeUndefined();
    }
    // The tiled upscale never adds it.
    expect(comfy.buildUpscaleWorkflow(request({ upscale: { width: 512, height: 512, factor: 2 } }), { ...on, upscaleMode: 'tiled' }, 'in.png').workflow['41']).toBeUndefined();
  });

  test('P3-31: a detailed generation runs end to end with the suggested detector; refusals name the part', async () => {
    comfy.detectorCache.clear();
    await comfy.generate(request(), cfg({ detailer: true }));
    expect(seen.prompts.at(-1)['40'].inputs.model_name).toBe('bbox/face_yolov8m.pt');
    expect(seen.prompts.at(-1)['9'].inputs.images).toEqual(['41', 0]);
    await comfy.generate(request({ quality: 'draft' }), cfg({ detailer: true }));
    expect(seen.prompts.at(-1)['41']).toBeUndefined();
    await expect(comfy.generate(request(), cfg({ detailer: true, detector: 'gone.pt' }))).rejects.toMatchObject({ message: `The face detector "gone.pt" isn't in ComfyUI any more` });
    await expect(comfy.generate(request(), cfg({ sampler: 'made_up' }))).rejects.toMatchObject({ message: `ComfyUI doesn't have the sampler "made_up"` });
    expect(comfy.validateConfig({ cfgScale: 31 }).error).toMatch(/CFG is 0–30/);
    expect(comfy.validateConfig({ steps: { high: 0 } }).error).toMatch(/1–150/);
    expect(comfy.validateConfig({ steps: [1] }).error).toMatch(/per quality/);
    expect(comfy.validateConfig({ negative: 'x'.repeat(1001) }).error).toMatch(/1000/);
    expect(comfy.validateConfig({ sampler: 5 }).error).toMatch(/sampler/);
    expect(comfy.validateConfig({ detailerDenoise: 0.9 }).error).toMatch(/0.1–0.8/);
    expect(comfy.validateConfig({ sampler: ' euler ', scheduler: '', cfgScale: 4.25, steps: { draft: 8, standard: '', high: null }, negative: '  ', detailer: true, detector: 'd.pt', detailerDenoise: 0.3 }))
      .toMatchObject({ sampler: 'euler', scheduler: null, cfgScale: 4.3, steps: { draft: 8 }, negative: null, detailer: true, detector: 'd.pt', detailerDenoise: 0.3 });
    expect(comfy.validateConfig({ steps: {} }).steps).toBeNull();
  });

  test('P3-33: passes: the face detailer’s cycle, and extra tiled passes chained with No Upscale', () => {
    expect(comfy.buildWorkflow(request(), cfg({ detailer: true, detector: 'd.pt', detailerPasses: 3 })).workflow['41'].inputs.cycle).toBe(3);
    expect(comfy.buildWorkflow(request(), cfg({ detailer: true, detector: 'd.pt', detailerPasses: 99 })).workflow['41'].inputs.cycle).toBe(5); // clamped
    const up = request({ upscale: { width: 512, height: 512, factor: 2 } });
    const wf = comfy.buildUpscaleWorkflow(up, cfg({ upscaler: 'u.pth', upscaleMode: 'tiled', tilePasses: 3, tileDenoise: 0.25 }), 'in.png', { seed: 10 }).workflow;
    expect(wf['31']).toMatchObject({ class_type: 'UltimateSDUpscaleNoUpscale', inputs: { upscaled_image: ['30', 0], seed: 11, denoise: 0.25, model: ['4', 0], positive: ['6', 0], vae: ['4', 2] } });
    expect(wf['32'].inputs).toMatchObject({ upscaled_image: ['31', 0], seed: 12 });
    for (const k of ['image', 'upscale_model', 'upscale_by']) expect(k in wf['31'].inputs).toBe(false);
    expect(wf['9'].inputs.images).toEqual(['32', 0]);
    expect(comfy.buildUpscaleWorkflow(up, cfg({ upscaler: 'u.pth', upscaleMode: 'tiled' }), 'in.png').workflow['31']).toBeUndefined(); // one pass by default
    expect(comfy.validateConfig({ detailerPasses: 0 }).error).toMatch(/1–5/);
    expect(comfy.validateConfig({ tilePasses: 4 }).error).toMatch(/1–3/);
    expect(comfy.validateConfig({ detailerPasses: 2, tilePasses: 3 })).toMatchObject({ detailerPasses: 2, tilePasses: 3 });
  });

  test('P3-33: a missing custom node leaves its feature out instead of failing, and says so', async () => {
    comfy.nodeCache.clear();
    hasTiled = false; // no Impact Pack FaceDetailer, no Ultimate SD Upscale here
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const made = await comfy.generate(request(), cfg({ detailer: true, detector: 'bbox/face_yolov8m.pt' }));
      expect(seen.prompts.at(-1)['41']).toBeUndefined();
      expect(made.notes).toEqual(['made without the face detailer: ComfyUI is missing FaceDetailer']);
      const up = await comfy.generate(request({ upscale: { buffer: PNG, width: 512, height: 512, factor: 2 } }), cfg({ upscaler: 'u.pth', upscaleMode: 'tiled', tilePasses: 2 }));
      expect(seen.prompts.at(-1)['30']).toBeUndefined();
      expect(seen.prompts.at(-1)['22'].class_type).toBe('ImageScale'); // the model-only upscale
      expect(up.notes[0]).toBe('upscaled with the upscale model only: ComfyUI is missing UltimateSDUpscale');
      // Checked once per node, then cached.
      const asked = seen.prompts.length;
      await comfy.generate(request(), cfg({ detailer: true, detector: 'bbox/face_yolov8m.pt' }));
      expect(seen.prompts.length).toBe(asked + 1);
      expect(comfy.nodeCache.get(`${mockUrl} FaceDetailer`)).toMatchObject({ has: false });
    } finally {
      hasTiled = true;
      comfy.nodeCache.clear();
      warn.mockRestore();
    }
    // With the nodes back, both are used again.
    await comfy.generate(request(), cfg({ detailer: true, detector: 'bbox/face_yolov8m.pt' }));
    expect(seen.prompts.at(-1)['41'].class_type).toBe('FaceDetailer');
  });

  test('P3-24: config for a split model needs its type and parts; Z-Image is split only', () => {
    expect(comfy.validateConfig({ kind: 'disk' }).error).toMatch(/Unknown model kind/);
    expect(comfy.validateConfig({ kind: 'unet', model: UNETS[2] }).error).toMatch(/pick its type: Flux or Z-Image Turbo/);
    expect(comfy.validateConfig({ kind: 'unet', model: UNETS[0], family: 'sdxl' }).error).toMatch(/pick its type/);
    expect(comfy.validateConfig({ kind: 'checkpoint', model: MODELS[1], family: 'zimage' }).error).toMatch(/separate parts, not a checkpoint/);
    expect(comfy.validateConfig({ enabled: true, url: mockUrl, kind: 'unet', model: UNETS[0], clip1: CLIPS[0], vae: VAES[0] }).error).toMatch(/both text encoders and the VAE/);
    expect(comfy.validateConfig({ enabled: true, url: mockUrl, kind: 'unet', model: UNETS[1], vae: VAES[1] }).error).toMatch(/the text encoder and the VAE/);
    expect(comfy.validateConfig({ clip1: 42 }).error).toMatch(/from the lists/);
    expect(comfy.validateConfig({ enabled: true, url: mockUrl, kind: 'unet', model: UNETS[1], clip1: CLIPS[2], vae: VAES[1] })).toEqual({
      enabled: true, url: mockUrl, kind: 'unet', model: UNETS[1], family: 'zimage', clip1: CLIPS[2], vae: VAES[1], tier: 'medium',
    });
  });

  test('SD 1.5 / SDXL workflows: checkpoint, sizes, sampler, and the negative nudge only outside 18+', () => {
    const { workflow, width, height } = comfy.buildWorkflow(request(), cfg());
    expect(workflow['4'].inputs.ckpt_name).toBe(MODELS[1]);
    expect(workflow['5']).toMatchObject({ class_type: 'EmptyLatentImage', inputs: { width: 1024, height: 1024 } });
    expect([width, height]).toEqual([1024, 1024]);
    expect(workflow['3'].inputs).toMatchObject({ steps: 28, cfg: 6, sampler_name: 'dpmpp_2m', scheduler: 'karras' });
    expect(workflow['9'].class_type).toBe('PreviewImage');
    expect(workflow['7'].inputs.text).toMatch(/nsfw, nude, nudity$/);
    expect(comfy.buildWorkflow(request(), cfg(), { permissive: true }).workflow['7'].inputs.text).not.toMatch(/nsfw/);
    const sd15 = comfy.buildWorkflow(request({ quality: 'draft' }), cfg({ family: 'sd15' }));
    expect([sd15.width, sd15.height]).toEqual([512, 512]);
  });

  test('Flux workflows: guidance, the SD3 latent, CFG 1 and no negative', () => {
    const { workflow } = comfy.buildWorkflow(request({ quality: 'high', shape: 'portrait' }), cfg({ model: MODELS[0], family: 'flux' }));
    expect(workflow['5'].class_type).toBe('EmptySD3LatentImage');
    expect(workflow['10']).toMatchObject({ class_type: 'FluxGuidance', inputs: { guidance: 3.5 } });
    expect(workflow['3'].inputs).toMatchObject({ cfg: 1, sampler_name: 'euler', scheduler: 'simple', steps: 28, positive: ['10', 0] });
    expect(workflow['7'].inputs.text).toBe('');
  });

  test('sizes are multiples of 64 and stay within the VRAM tier (10% rounding allowance)', () => {
    for (const family of ['sd15', 'sdxl', 'flux']) {
      for (const quality of ['draft', 'standard', 'high']) {
        for (const shape of ['square', 'portrait', 'landscape', 'wide']) {
          for (const tier of ['low', 'medium', 'high']) {
            const { width, height } = comfy.sizeFor(family, quality, shape, tier);
            expect(width % 64).toBe(0);
            expect(height % 64).toBe(0);
            expect(width * height).toBeLessThanOrEqual(comfy.TIERS[tier] * 1e6 * 1.1);
          }
        }
      }
    }
    expect(comfy.sizeFor('flux', 'high', 'square', 'low')).toEqual({ width: 1024, height: 1024 });
    const wide = comfy.sizeFor('sdxl', 'standard', 'wide', 'high');
    expect(wide.width).toBeGreaterThan(wide.height);
  });

  test('a generation queues the prompt, waits for it and fetches the image', async () => {
    const out = await comfy.generate(request(), cfg());
    expect(out).toMatchObject({ model: MODELS[1], width: 1024, height: 1024 });
    expect(out.images[0].buffer.equals(PNG)).toBe(true);
    expect(seen.prompts.at(-1)['6'].inputs.text).toBe('a gourd in a hat');
  });

  test('failures in plain words: a missing model, an unreachable server, ComfyUI erroring', async () => {
    await expect(comfy.generate(request(), cfg({ model: 'missing.safetensors' }))).rejects.toMatchObject({ code: 'ENGINE', message: 'The model "missing.safetensors" isn\'t in ComfyUI any more' });
    await expect(comfy.generate(request(), cfg({ url: 'http://127.0.0.1:1' }))).rejects.toMatchObject({ code: 'UNAVAILABLE', message: "ComfyUI isn't reachable at http://127.0.0.1:1" });
    await expect(comfy.generate(request({ prompt: 'x [boom]' }), cfg())).rejects.toMatchObject({ code: 'ENGINE', message: 'ComfyUI failed: CUDA out of memory' });
    await expect(comfy.listModels('http://127.0.0.1:1')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });

  test('stopping a job interrupts it if running, or takes it out of the queue', async () => {
    let ac = new AbortController();
    setTimeout(() => ac.abort(), 80);
    await expect(comfy.generate(request({ prompt: 'long [slow]' }), cfg(), { signal: ac.signal })).rejects.toMatchObject({ code: 'ABORTED' });
    expect(seen.interrupts).toBe(1);
    ac = new AbortController();
    setTimeout(() => ac.abort(), 80);
    await expect(comfy.generate(request({ prompt: 'waiting [queued]' }), cfg(), { signal: ac.signal })).rejects.toMatchObject({ code: 'ABORTED' });
    expect(seen.deleted).toContain(`p${promptCount}`);
  });

  test('config: URL, type and tier are checked; turning it on needs an address and a model', () => {
    expect(comfy.validateConfig({ url: 'not a url' }).error).toMatch(/must be a URL/);
    expect(comfy.validateConfig({ url: 'ftp://host' }).error).toMatch(/http/);
    expect(comfy.validateConfig({ url: 'http://u:p@host:8188' }).error).toMatch(/without a username/);
    expect(comfy.validateConfig({ family: 'sd3' }).error).toMatch(/SD 1.5, SDXL, Flux or Z-Image Turbo/);
    expect(comfy.validateConfig({ tier: 'huge' }).error).toMatch(/low, medium or high/);
    expect(comfy.validateConfig({ enabled: true }).error).toMatch(/pick a model/);
    expect(comfy.validateConfig({ enabled: true, url: 'http://192.168.1.20:8188/', model: MODELS[0] })).toEqual({
      enabled: true, url: 'http://192.168.1.20:8188', model: MODELS[0], family: 'flux', tier: 'medium', kind: 'checkpoint',
    });
  });
});

describe('the admin routes and the chat path', () => {
  const users = {};
  const call = async (who, method, p, body) => {
    const res = await fetch(`http://localhost:${port}${p}`, {
      method, headers: { 'content-type': 'application/json', Authorization: `Bearer ${users[who].token}` }, body: body && JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  beforeAll(async () => {
    for (const name of ['admin', 'pat']) {
      const res = await fetch(`http://localhost:${port}/register`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: name, password: 'password123', email: `${name}@example.com` }),
      });
      users[name] = { token: (await res.json()).token, id: db.getUserByUsername(name).id };
    }
  });

  test('test connection: site admins only; a bad address and an unreachable one are explained', async () => {
    expect((await call('pat', 'POST', '/admin/imagine/comfyui/test', { url: mockUrl })).status).toBe(403);
    expect((await call('admin', 'POST', '/admin/imagine/comfyui/test', { url: 'nope' })).status).toBe(400);
    expect((await call('admin', 'POST', '/admin/imagine/comfyui/test', { url: 'http://127.0.0.1:1' })).body.error).toMatch(/isn't reachable/);
    const ok = await call('admin', 'POST', '/admin/imagine/comfyui/test', { url: `${mockUrl}/` });
    expect(ok.body).toMatchObject({ url: mockUrl, clips: CLIPS, vaes: VAES });
    expect(ok.body.models.slice(0, 4)).toMatchObject([{ family: 'flux' }, { family: 'sdxl' }, { family: 'sd15' }, { kind: 'unet', family: 'flux' }]);
  });

  test('saving the ComfyUI settings, a test image, and the always-refused check', async () => {
    expect((await call('admin', 'PUT', '/admin/imagine', { engines: { comfyui: { enabled: true } } })).body.error).toMatch(/pick a model/);
    const saved = await call('admin', 'PUT', '/admin/imagine', { engines: { comfyui: { enabled: true, url: mockUrl, model: MODELS[0], tier: 'high' } }, defaultEngine: 'comfyui' });
    expect(saved.body.engines.find((e) => e.id === 'comfyui').config).toEqual({ enabled: true, url: mockUrl, model: MODELS[0], family: 'flux', tier: 'high', kind: 'checkpoint', clip1: null, clip2: null, vae: null, hires: true, upscaler: null, upscaleMode: 'model', tileDenoise: 0.3, tileSize: 1024,
      sampler: null, scheduler: null, cfgScale: null, steps: null, negative: null, detailer: false, detector: null, detailerDenoise: 0.4, detailerPasses: 1, tilePasses: 1 });
    expect((await call('pat', 'POST', '/admin/imagine/try', { engine: 'comfyui', prompt: 'x' })).status).toBe(403);
    expect((await call('admin', 'POST', '/admin/imagine/try', { engine: 'comfyui', prompt: 'nude 12 year old' })).status).toBe(400);
    const tried = await call('admin', 'POST', '/admin/imagine/try', { engine: 'comfyui', prompt: 'a gourd', shape: 'wide', quality: 'draft' });
    expect(tried.status).toBe(200);
    expect(tried.body).toMatchObject({ width: 1024, height: 576, model: MODELS[0] });
    expect(fs.readFileSync(path.join(UPLOADS, tried.body.url.replace(/^\/uploads\//, ''))).equals(PNG)).toBe(true);
  });

  test('a chat /imagine request runs on ComfyUI and posts the image', async () => {
    const spaceId = db.createSpaceWithDefaults('Comfy Club', users.admin.id);
    await call('admin', 'PATCH', '/spaces/Comfy%20Club/imagine', { enabled: true });
    const frames = [];
    const ws = new WebSocket(`ws://localhost:${port}/gateway?token=${users.admin.token}`);
    ws.on('message', (raw) => frames.push(JSON.parse(raw.toString())));
    await new Promise((r) => ws.on('open', r));
    ws.send(JSON.stringify({ op: 'imagine', space: 'Comfy Club', channel: 'general', prompt: 'a gourd on a hill', shape: 'landscape' }));
    const end = Date.now() + 5000;
    let done;
    while (!done && Date.now() < end) {
      done = frames.find((f) => f.type === 'message_update' && f.attachments && f.attachments.length);
      await new Promise((r) => setTimeout(r, 20));
    }
    ws.close();
    expect(done.content).toBe('🎨 **admin** imagined: a gourd on a hill');
    const job = db.raw.prepare('SELECT * FROM imagine_jobs WHERE space_id = ? ORDER BY id DESC').get(spaceId);
    expect(job).toMatchObject({ engine: 'comfyui', status: 'done', model: MODELS[0] });
  });

  test('P3-29: the Upscale button: 2× under the 4096 px cap, posted for the presser; Retry; refusals', async () => {
    const S = 'Comfy Club';
    const { channelId } = db.channelRef(S, 'general');
    const spaceId = db.getSpaceByName(S).id;
    await call('admin', 'PUT', '/admin/imagine', { engines: { comfyui: { enabled: true, url: mockUrl, model: MODELS[1], family: 'sdxl', upscaler: '4x-UltraSharp.pth', upscaleMode: 'model' } }, defaultEngine: 'comfyui' });
    await call('admin', 'PATCH', `/spaces/${encodeURIComponent(S)}/imagine`, { dailyLimit: 100 });
    // A finished image of a given size, as the bot posted it.
    const finished = (w, h, kind = 'generate') => {
      const token = require('crypto').randomBytes(9).toString('hex');
      fs.mkdirSync(path.join(UPLOADS, token), { recursive: true });
      const head = Buffer.alloc(33);
      head.writeUInt32BE(0x89504e47, 0);
      head.writeUInt32BE(w, 16);
      head.writeUInt32BE(h, 20);
      fs.writeFileSync(path.join(UPLOADS, token, 'imagine-1.png'), head);
      const url = `/uploads/${token}/imagine-1.png`;
      const msg = db.postAsBot(S, 'general', '🎨 **pat** imagined: a gourd on a hill');
      db.updateBotMessage(Number(msg.id), '🎨 **pat** imagined: a gourd on a hill', [url]);
      const id = db.createImagineJob({ userId: users.admin.id, spaceId, channelId, engine: 'comfyui', prompt: 'a gourd on a hill', shape: 'landscape', quality: 'high', kind, sourceUrl: kind === 'upscale' ? url : null });
      db.updateImagineJob(id, { messageId: Number(msg.id), status: 'done' });
      return { messageId: Number(msg.id), jobId: id, url };
    };
    const frames = [];
    const ws = new WebSocket(`ws://localhost:${port}/gateway?token=${users.admin.token}`);
    ws.on('message', (raw) => frames.push(JSON.parse(raw.toString())));
    await new Promise((r) => ws.on('open', r));
    const ask = async (fields) => {
      const from = frames.length;
      ws.send(JSON.stringify({ op: 'imagine', space: S, channel: 'general', ...fields }));
      const end = Date.now() + 3000;
      for (;;) {
        const f = frames.slice(from).find((x) => x.type === 'imagine_queued' || (x.type === 'error' && x.op === 'imagine'));
        if (f) return f.type === 'error' ? f.code : f;
        if (Date.now() > end) throw new Error('no answer');
        await new Promise((r) => setTimeout(r, 15));
      }
    };
    const settle = async (jobId) => {
      const end = Date.now() + 5000;
      while (!['done', 'failed'].includes(db.getImagineJob(jobId).status) && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
      return db.getImagineJob(jobId);
    };
    try {
      expect((await call('admin', 'GET', '/spaces')).body.find((s) => s.name === S).imagine.canUpscale).toBe(true);
      // 1536×1024 → 3072×2048, posted under the presser's name, counted for them.
      const src = finished(1536, 1024);
      const used = db.countImagineJobsSince(users.admin.id, 0);
      const up = await ask({ from: src.messageId, upscale: true });
      expect(db.getImagineJob(up.jobId)).toMatchObject({ kind: 'upscale', source_url: src.url, prompt: 'a gourd on a hill', user_id: users.admin.id });
      expect(db.countImagineJobsSince(users.admin.id, 0)).toBe(used + 1);
      expect((await settle(up.jobId)).status).toBe('done');
      expect(seen.uploads.at(-1)).toMatchObject({ type: 'multipart/form-data', overwrite: true });
      expect(seen.uploads.at(-1).name).toMatch(/^disgourd-upscale-[a-f0-9]+\.png$/);
      const wf = seen.prompts.at(-1);
      expect(wf['1'].inputs.image).toBe(seen.uploads.at(-1).name);
      expect(wf['22'].inputs).toMatchObject({ width: 3072, height: 2048 });
      expect(db.raw.prepare('SELECT content FROM messages WHERE id = ?').get(up.messageId).content).toBe('🔍 **admin** upscaled: a gourd on a hill');
      expect(JSON.parse(db.raw.prepare('SELECT attachments FROM messages WHERE id = ?').get(up.messageId).attachments)[0]).toMatch(/\/disgourd-[\d-]+-upscaled\.png$/); // P3-32
      // The cap: 3000×2000 becomes 4096 wide; 4096 square is refused.
      const wide = await ask({ from: finished(3000, 2000).messageId, upscale: true });
      await settle(wide.jobId);
      expect(seen.prompts.at(-1)['22'].inputs).toMatchObject({ width: 4096, height: 2728 });
      expect(await ask({ from: finished(4096, 4096).messageId, upscale: true })).toBe('TOO_BIG');
      // An upscaled image isn't offered again; a failed upscale is retried as an upscale.
      expect(await ask({ from: up.messageId, upscale: true })).toBe('NOT_FOUND');
      const failed = finished(1024, 1024, 'upscale');
      db.updateImagineJob(failed.jobId, { status: 'failed' });
      const retry = await ask({ from: failed.messageId });
      expect(db.getImagineJob(retry.jobId)).toMatchObject({ kind: 'upscale', source_url: failed.url });
      await settle(retry.jobId);
      // Tiled mode goes through Ultimate SD Upscale.
      await call('admin', 'PUT', '/admin/imagine', { engines: { comfyui: { upscaleMode: 'tiled' } } });
      const tiled = await ask({ from: src.messageId, upscale: true });
      await settle(tiled.jobId);
      expect(seen.prompts.at(-1)['30']).toMatchObject({ class_type: 'UltimateSDUpscale', inputs: { upscale_by: 2 } });
      // With ComfyUI off there's nothing to upscale with.
      await call('admin', 'PUT', '/admin/imagine', { engines: { comfyui: { enabled: false } } });
      expect(await ask({ from: src.messageId, upscale: true })).toBe('NO_ENGINE');
    } finally {
      ws.close();
      await call('admin', 'PUT', '/admin/imagine', { engines: { comfyui: { enabled: true, upscaleMode: 'model' } } });
    }
  });
});
