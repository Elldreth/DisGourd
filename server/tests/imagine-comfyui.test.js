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
// Since P9-04a a saved config keeps per-style settings in `presets`; this is
// the flat setup the default style runs with (or the error).
const flatCfg = (input, prev) => {
  const out = comfy.validateConfig(input, prev);
  return out.error ? out : comfy.styleConfig(out).config;
};
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
let partsListed = true;
// Core nodes the mock knows by name (P3-34 checks a custom workflow's nodes).
const KNOWN_NODES = ['CheckpointLoaderSimple', 'KSampler', 'EmptyLatentImage', 'CLIPTextEncode', 'VAEDecode', 'SaveImage', 'PreviewImage', 'LoadImage', 'ImageScaleBy', 'GoneNode']; // false: this ComfyUI can't list split parts

// What the mock saw.
const seen = { prompts: [], deleted: [], interrupts: 0, uploads: [] };
let hasTiled = true; // whether the mock has the Ultimate SD Upscale node
let hasExtras = true; // P9-08: SAMLoader (with a model), KJNodes' ColorMatch, WAS's Image Filter Adjustments
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
      if (url.pathname === '/object_info/SAMLoader') return json(200, hasExtras ? { SAMLoader: { input: { required: { model_name: [['sam_vit_h_4b8939.pth', 'sam_vit_b_01ec64.pth']] } } } } : {});
      if (url.pathname === '/object_info/ColorMatch') return json(200, hasExtras ? { ColorMatch: { input: { required: {} } } } : {});
      if (decodeURIComponent(url.pathname) === '/object_info/Image Filter Adjustments') return json(200, hasExtras ? { 'Image Filter Adjustments': { input: { required: {} } } } : {});
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
        // P3-34: a node ComfyUI doesn't have.
        if (Object.values(prompt).some((n) => n.class_type === 'GoneNode')) {
          return json(400, { error: { type: 'missing_node_type', message: "Node 'GoneNode' not found. The custom node may not be installed.", extra_info: { class_type: 'GoneNode' } } });
        }
        promptsById.set(id, { text: prompt['6']?.inputs.text || 'upscale', polls: 0, prompt });
        return json(200, { prompt_id: id, number: promptCount });
      }
      if (url.pathname.startsWith('/history/')) {
        const id = decodeURIComponent(url.pathname.slice(9));
        const p = promptsById.get(id);
        if (!p) return json(200, {});
        p.polls += 1;
        if (p.text.includes('[slow]') || p.text.includes('[queued]') || p.polls < 2) return json(200, {}); // not done yet
        if (p.text.includes('[boom]')) return json(200, { [id]: { status: { status_str: 'error', completed: false, messages: [['execution_error', { exception_message: 'CUDA out of memory' }]] }, outputs: {} } });
        // The built-in workflows save from node 9; a custom one from each Save / Preview node.
        const saves = Object.entries(p.prompt).filter(([, n]) => n.class_type === 'SaveImage' || n.class_type === 'PreviewImage').map(([nid]) => nid);
        const outputs = p.prompt['9'] ? { 9: { images: [{ filename: 'ComfyUI_temp_1.png', subfolder: '', type: 'temp' }] } }
          : Object.fromEntries(saves.map((nid) => [nid, { images: [{ filename: `out_${nid}.png`, subfolder: '', type: 'output' }] }]));
        return json(200, { [id]: { status: { status_str: 'success', completed: true }, outputs } });
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
      const node = url.pathname.match(/^\/object_info\/(\w+)$/);
      if (node && KNOWN_NODES.includes(node[1])) return json(200, { [node[1]]: { input: { required: {} } } });
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

// A host's own workflow (P3-34), as ComfyUI's Export (API) gives it, with placeholders.
const CUSTOM = {
  3: { class_type: 'KSampler', inputs: { seed: '{{seed}}', steps: '{{steps}}', cfg: 5, sampler_name: 'euler', scheduler: 'normal', denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] } },
  4: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'my-model.safetensors' } },
  5: { class_type: 'EmptyLatentImage', inputs: { width: '{{width}}', height: '{{height}}', batch_size: 1 } },
  6: { class_type: 'CLIPTextEncode', inputs: { text: 'masterpiece, {{prompt}}', clip: ['4', 1] } },
  7: { class_type: 'CLIPTextEncode', inputs: { text: '{{negative}}', clip: ['4', 1] } },
  8: { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
  50: { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: 'mine' } },
  51: { class_type: 'PreviewImage', inputs: { images: ['8', 0] } },
};
const CUSTOM_UP = {
  1: { class_type: 'LoadImage', inputs: { image: '{{image}}' } },
  2: { class_type: 'ImageScaleBy', inputs: { image: ['1', 0], upscale_method: 'lanczos', scale_by: '{{scale}}' } },
  3: { class_type: 'SaveImage', inputs: { images: ['2', 0], filename_prefix: 'up' } },
};
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
      anima: { clip1: null, clip2: null, vae: null }, // P3-35: this ComfyUI has no Anima encoder or VAE
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
    expect([width, height]).toEqual([1792, 1792]); // P9-08: the Medium tier's 1792 long edge
    expect(wf['20']).toEqual({ class_type: 'UpscaleModelLoader', inputs: { model_name: '4x-UltraSharp.pth' } });
    expect(wf['21']).toEqual({ class_type: 'ImageUpscaleWithModel', inputs: { upscale_model: ['20', 0], image: ['8', 0] } });
    expect(wf['22']).toEqual({ class_type: 'ImageScale', inputs: { image: ['21', 0], upscale_method: 'lanczos', width: 1792, height: 1792, crop: 'disabled' } });
    expect(wf['23']).toEqual({ class_type: 'VAEEncode', inputs: { pixels: ['22', 0], vae: ['4', 2] } });
    // P9-08: 15 hires steps at 0.45; the base image keeps High's (15) steps.
    expect(wf['24'].inputs).toMatchObject({ seed: 7, denoise: 0.45, steps: 15, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['23', 0] });
    expect(wf['3'].inputs.steps).toBe(15);
    // P9-08: then a Color Match back to the base image.
    expect(wf['43']).toEqual({ class_type: 'ColorMatch', inputs: { image_ref: ['8', 0], image_target: ['25', 0], method: 'hm-mvgd-hm', strength: 1, multithread: true } });
    expect(wf['9'].inputs.images).toEqual(['43', 0]);
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
    // P9-08: the SDXL family's hires reaches each tier's long edge (multiples of 8).
    for (const tier of ['low', 'medium', 'high']) {
      for (const shape of ['square', 'portrait', 'landscape', 'wide']) {
        const out = comfy.buildWorkflow(request({ quality: 'high', shape }), { ...on, tier });
        expect(out.width % 8 + out.height % 8).toBe(0);
        expect(Math.max(out.width, out.height)).toBe(comfy.HIRES_LONG[tier]);
      }
    }
    // Other families keep the megapixel budget (10% rounding allowance).
    const sd = comfy.buildWorkflow(request({ quality: 'high' }), { ...on, family: 'sd15', tier: 'high' });
    expect(sd.width * sd.height).toBeLessThanOrEqual(comfy.HIRES_MP.high * 1e6 * 1.1);
  });

  test('P3-28: a hires generation runs end to end; a missing upscale model is explained; config round-trips', async () => {
    const out = await comfy.generate(request({ quality: 'high' }), cfg({ upscaler: '4x-UltraSharp.pth', tier: 'high' }));
    expect(out).toMatchObject({ width: 2048, height: 2048 }); // P9-08: 1216 square -> 2048
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
    expect(out).toMatchObject({ width: 2048, height: 2048 });
    expect(seen.prompts.at(-1)['20'].inputs.model_name).toBe('4x-UltraSharp.pth');
    expect(seen.prompts.length).toBe(before + 1);
    expect(comfy.upscalerCache.get(mockUrl)).toMatchObject({ name: '4x-UltraSharp.pth' });
    expect(await comfy.resolveUpscaler(cfg({ upscaler: 'mine.pth' }))).toBe('mine.pth'); // a saved one wins
    // Switched off: no upscale model is looked for or used.
    expect((await comfy.generate(request({ quality: 'high' }), cfg({ hires: false }))).width).toBe(1216); // High's own size (High tier square, P9-08), no fix
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
      // P9-08: the owner's Phase 5 sampling for classic-CFG models.
      upscale_by: 2, seed: 5, steps: 30, cfg: 6, sampler_name: 'ddim', scheduler: 'simple', denoise: 0.25, tile_width: 768, tile_height: 768, mode_type: 'Linear', seam_fix_mode: 'None',
      mask_blur: 16, tile_padding: 64, force_uniform_tiles: true, tiled_decode: false,
    });
    expect(tiled['3'] || tiled['5'] || tiled['8']).toBeUndefined(); // no KSampler, latent or decode of its own
    // P9-08: Color Match back to the image being upscaled, then saturation 1.15.
    expect(tiled['50']).toEqual({ class_type: 'ColorMatch', inputs: { image_ref: ['1', 0], image_target: ['30', 0], method: 'hm-mvgd-hm', strength: 1, multithread: true } });
    expect(tiled['51']).toEqual({
      class_type: 'Image Filter Adjustments',
      inputs: { image: ['50', 0], brightness: 0, contrast: 1, saturation: 1.15, sharpness: 1, blur: 0, gaussian_blur: 0, edge_enhance: 0, detail_enhance: false },
    });
    expect(tiled['9'].inputs.images).toEqual(['51', 0]);
    expect(tiled['7'].inputs.text).toMatch(/nsfw/); // the negative nudge still applies outside 18+
    // Flux in parts: its loaders, guidance and VAE; default denoise and tile size.
    const flux = comfy.buildUpscaleWorkflow(request(up), cfg({ kind: 'unet', model: UNETS[0], family: 'flux', clip1: CLIPS[0], clip2: CLIPS[1], vae: VAES[0], upscaler: 'u.pth', upscaleMode: 'tiled' }), 'in.png').workflow;
    expect(flux['30'].inputs).toMatchObject({ model: ['11', 0], positive: ['10', 0], vae: ['13', 0], cfg: 1, steps: 20, denoise: 0.2, tile_width: 1280 }); // its own sampling
  });

  test('P3-29: Upscale config: mode, denoise and tile size are checked', () => {
    expect(comfy.validateConfig({ upscaleMode: 'huge' }).error).toMatch(/upscale mode/);
    expect(comfy.validateConfig({ tileDenoise: 0.9 }).error).toMatch(/0.05–0.6/);
    expect(comfy.validateConfig({ tileSize: 1000 }).error).toMatch(/steps of 64/);
    expect(comfy.validateConfig({ upscaleMode: 'tiled', tileDenoise: 0.35, tileSize: 1536 })).toMatchObject({ upscaleMode: 'tiled', tileDenoise: 0.35, tileSize: 1536 });
    expect(comfy.publicConfig({})).toMatchObject({ upscaleMode: 'model', tileDenoise: 0.2, tileSize: 1280 }); // P9-08 defaults
  });

  test('P3-31: advanced sampler, scheduler, CFG and steps reach every sampling node; blanks keep the defaults', () => {
    const adv = cfg({ sampler: 'dpmpp_2m_sde', scheduler: 'exponential', cfgScale: 4.5, steps: { draft: 9, standard: 22, high: 40 }, upscaler: 'u.pth', tier: 'high' });
    const high = comfy.buildWorkflow(request({ quality: 'high' }), adv).workflow;
    expect(high['3'].inputs).toMatchObject({ sampler_name: 'dpmpp_2m_sde', scheduler: 'exponential', cfg: 4.5, steps: 40 });
    expect(high['24'].inputs).toMatchObject({ sampler_name: 'dpmpp_2m_sde', scheduler: 'exponential', cfg: 4.5, steps: 15 }); // the hires repaint: its own steps (P9-08)
    expect(comfy.buildWorkflow(request({ quality: 'high' }), { ...adv, hiresSteps: 12 }).workflow['24'].inputs.steps).toBe(12);
    expect(comfy.buildWorkflow(request({ quality: 'draft' }), adv).workflow['3'].inputs.steps).toBe(9);
    const tiled = comfy.buildUpscaleWorkflow(request({ upscale: { width: 512, height: 512, factor: 2 } }), { ...adv, upscaleMode: 'tiled' }, 'in.png').workflow;
    // P9-08: the tiled upscale's sampling is built in for classic-CFG models.
    expect(tiled['30'].inputs).toMatchObject({ sampler_name: 'ddim', scheduler: 'simple', cfg: 6, steps: 30 });
    // Blank: the model type's tuned defaults; a partial steps object fills the rest.
    expect(comfy.buildWorkflow(request(), cfg()).workflow['3'].inputs).toMatchObject({ sampler_name: 'dpmpp_2m', scheduler: 'karras', cfg: 5, steps: 15 });
    expect(comfy.buildWorkflow(request({ quality: 'high' }), cfg({ steps: { draft: 5 } })).workflow['3'].inputs.steps).toBe(15);
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
        // P9-08: CLIP skip 2 (node 15); the owner's settings (guide and max 1024 for the
        // face box, crop factor 3, 30 steps, CFG 5, ddim / simple), the saved strength, 3 passes.
        image: ['8', 0], model: ['4', 0], clip: ['15', 0], vae: ['4', 2], positive: ['6', 0], negative: ['7', 0], bbox_detector: ['40', 0],
        seed: 3, steps: 30, cfg: 5, sampler_name: 'ddim', scheduler: 'simple', denoise: 0.35, guide_size: 1024, guide_size_for: true, max_size: 1024, bbox_crop_factor: 3,
        sam_mask_hint_use_negative: 'False', cycle: 3,
      },
    });
    expect(std.workflow['9'].inputs.images).toEqual(['43', 0]); // then Color Match
    expect(std.workflow['43'].inputs).toMatchObject({ image_ref: ['8', 0], image_target: ['41', 0] });
    const high = comfy.buildWorkflow(request({ quality: 'high' }), on).workflow;
    expect(high['41'].inputs.image).toEqual(['25', 0]); // after the hires repaint
    // Flux in parts: its own loaders and guidance; SD 1.5 guides at 512.
    const flux = comfy.buildWorkflow(request(), cfg({ kind: 'unet', model: UNETS[0], family: 'flux', clip1: CLIPS[0], clip2: CLIPS[1], vae: VAES[0], detailer: true, detector: 'd.pt' })).workflow;
    expect(flux['41'].inputs).toMatchObject({ model: ['11', 0], clip: ['12', 0], vae: ['13', 0], positive: ['10', 0], cfg: 1, sampler_name: 'euler' }); // its own sampling
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
    expect(seen.prompts.at(-1)['41'].class_type).toBe('FaceDetailer');
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
    expect(flatCfg({ sampler: ' euler ', scheduler: '', cfgScale: 4.25, steps: { draft: 8, standard: '', high: null }, negative: '  ', detailer: true, detector: 'd.pt', detailerDenoise: 0.3 }))
      .toMatchObject({ sampler: 'euler', scheduler: null, cfgScale: 4.3, steps: { draft: 8 }, negative: null, detailer: true, detector: 'd.pt', detailerDenoise: 0.3 });
    expect(flatCfg({ steps: {} }).steps).toBeNull();
  });

  test('P3-33: passes: the face detailer’s cycle, and extra tiled passes chained with No Upscale', () => {
    expect(comfy.buildWorkflow(request(), cfg({ detailer: true, detector: 'd.pt', detailerPasses: 3 })).workflow['41'].inputs.cycle).toBe(3);
    expect(comfy.buildWorkflow(request(), cfg({ detailer: true, detector: 'd.pt', detailerPasses: 99 })).workflow['41'].inputs.cycle).toBe(5); // clamped
    const up = request({ upscale: { width: 512, height: 512, factor: 2 } });
    const wf = comfy.buildUpscaleWorkflow(up, cfg({ upscaler: 'u.pth', upscaleMode: 'tiled', tilePasses: 3, tileDenoise: 0.25 }), 'in.png', { seed: 10 }).workflow;
    expect(wf['31']).toMatchObject({ class_type: 'UltimateSDUpscaleNoUpscale', inputs: { upscaled_image: ['30', 0], seed: 11, denoise: 0.25, model: ['4', 0], positive: ['6', 0], vae: ['4', 2] } });
    expect(wf['32'].inputs).toMatchObject({ upscaled_image: ['31', 0], seed: 12 });
    for (const k of ['image', 'upscale_model', 'upscale_by']) expect(k in wf['31'].inputs).toBe(false);
    expect(wf['50'].inputs.image_target).toEqual(['32', 0]); // the last pass feeds Color Match (P9-08)
    expect(wf['9'].inputs.images).toEqual(['51', 0]);
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

  test('P3-34: checking a custom workflow: API format, placeholders, size', () => {
    expect(comfy.checkWorkflow('{ not json').error).toBe('That isn’t valid JSON');
    expect(comfy.checkWorkflow(JSON.stringify({ nodes: [], links: [] })).error).toMatch(/regular workflow file.*Export \(API\)/);
    expect(comfy.checkWorkflow(JSON.stringify({ 1: { inputs: {} } })).error).toMatch(/class_type and inputs/);
    expect(comfy.checkWorkflow(JSON.stringify({ 1: { class_type: 'KSampler', inputs: { seed: 1 } } })).error).toBe('The workflow needs {{prompt}} in one of its fields');
    expect(comfy.checkWorkflow(JSON.stringify({ 1: { class_type: 'CLIPTextEncode', inputs: { text: '{{prompt}} {{lora}}' } } })).error).toMatch(/^Unknown placeholder: \{\{lora\}\}\. Use \{\{prompt\}\}/);
    expect(comfy.checkWorkflow(JSON.stringify({ 1: { class_type: 'LoadImage', inputs: { image: '{{image}}' } } }), 'upscale').classTypes).toEqual(['LoadImage']);
    expect(comfy.checkWorkflow(JSON.stringify({ 1: { class_type: 'CLIPTextEncode', inputs: { text: '{{prompt}}' } } }), 'upscale').error).toMatch(/needs \{\{image\}\}/);
    expect(comfy.checkWorkflow('x'.repeat(256 * 1024 + 1)).error).toBe('The workflow is over 256 KB');
    expect(comfy.checkWorkflow(CUSTOM)).toMatchObject({ classTypes: ['KSampler', 'CheckpointLoaderSimple', 'EmptyLatentImage', 'CLIPTextEncode', 'VAEDecode', 'SaveImage', 'PreviewImage'] });
  });

  test('P3-34: placeholders: whole fields keep their type, text is filled in place, each request a new seed', () => {
    const a = comfy.buildCustomWorkflow(CUSTOM, request({ prompt: 'a gourd', quality: 'high', shape: 'wide' }), cfg({ family: 'sdxl', tier: 'medium', steps: { high: 44 } })).workflow;
    expect(a['5'].inputs).toEqual({ ...comfy.sizeFor('sdxl', 'high', 'wide', 'medium'), batch_size: 1 }); // numbers, as the built-in sizes
    expect(typeof a['5'].inputs.width).toBe('number');
    expect(a['6'].inputs.text).toBe('masterpiece, a gourd');
    expect(a['7'].inputs.text).toMatch(/nsfw, nude, nudity$/); // the safety words outside 18+
    expect(a['3'].inputs).toMatchObject({ steps: 44, cfg: 5, sampler_name: 'euler' }); // the host's own values stay
    expect(typeof a['3'].inputs.seed).toBe('number');
    const b = comfy.buildCustomWorkflow(CUSTOM, request(), cfg()).workflow;
    expect(b['3'].inputs.seed).not.toBe(a['3'].inputs.seed);
    expect(CUSTOM['6'].inputs.text).toBe('masterpiece, {{prompt}}'); // the stored one is untouched
    expect(comfy.fillWorkflow({ 1: { class_type: 'X', inputs: { a: '{{ quality }}', b: '{{scale}}', c: ['2', 0] } } }, { quality: 'draft', scale: 1.5 })['1'].inputs).toEqual({ a: 'draft', b: 1.5, c: ['2', 0] });
  });

  test('P3-34: a custom workflow runs end to end; every output image comes back; nothing built-in is added', async () => {
    const out = await comfy.generate(request({ prompt: 'a gourd in a hat', quality: 'high' }), cfg({ workflowMode: 'custom', workflow: CUSTOM, detailer: true, detector: 'd.pt', upscaler: 'u.pth' }));
    expect(out.images).toHaveLength(2); // SaveImage and PreviewImage
    const sent = seen.prompts.at(-1);
    expect(Object.keys(sent).sort()).toEqual(Object.keys(CUSTOM).sort()); // no hires / detailer nodes added
    expect(sent['6'].inputs.text).toBe('masterpiece, a gourd in a hat');
    // An upscale with the host's upscale workflow: the uploaded image and the scale.
    const up = await comfy.generate(request({ upscale: { buffer: PNG, width: 600, height: 400, factor: 2 } }), cfg({ workflowMode: 'custom', workflow: CUSTOM, upscaleWorkflow: CUSTOM_UP }));
    expect(seen.uploads.at(-1).name).toMatch(/^disgourd-upscale-/);
    expect(seen.prompts.at(-1)['1'].inputs.image).toBe(seen.uploads.at(-1).name);
    expect(seen.prompts.at(-1)['2'].inputs.scale_by).toBe(2);
    expect(up).toMatchObject({ width: 1200, height: 800 });
    // Without an upscale workflow, the built-in upscale is used.
    await comfy.generate(request({ upscale: { buffer: PNG, width: 600, height: 400, factor: 2 } }), cfg({ workflowMode: 'custom', workflow: CUSTOM, upscaler: 'u.pth' }));
    expect(seen.prompts.at(-1)['22'].class_type).toBe('ImageScale');
    // A node gone from ComfyUI later: a plain failure naming it.
    const gone = { ...CUSTOM, 60: { class_type: 'GoneNode', inputs: {} } };
    await expect(comfy.generate(request(), cfg({ workflowMode: 'custom', workflow: gone }))).rejects.toMatchObject({ message: "Your custom workflow needs GoneNode, which ComfyUI doesn't have" });
  });

  test('P3-34: config: My own needs a workflow, and then no model; bad workflows are refused with the reason', () => {
    expect(comfy.validateConfig({ workflowMode: 'other' }).error).toMatch(/builtin" or "custom/);
    expect(comfy.validateConfig({ workflowMode: 'custom' }).error).toMatch(/Add your workflow/);
    expect(comfy.validateConfig({ workflow: '{"nodes": []}' }).error).toMatch(/^Workflow: That’s the regular workflow file/);
    expect(comfy.validateConfig({ upscaleWorkflow: JSON.stringify(CUSTOM) }).error).toMatch(/^Upscale workflow: Unknown placeholders: \{\{steps\}\}, \{\{width\}\}, \{\{height\}\}/); // generate-only ones
    const ok = comfy.validateConfig({ enabled: true, url: mockUrl, workflowMode: 'custom', workflow: JSON.stringify(CUSTOM) });
    expect(comfy.styleConfig(ok).config).toMatchObject({ enabled: true, workflowMode: 'custom', workflow: CUSTOM });
    expect(comfy.publicConfig(ok).workflow).toBe(JSON.stringify(CUSTOM, null, 2));
    expect(comfy.validateConfig({ workflow: '' }, ok).error).toMatch(/Add your workflow/); // clearing it while My own is on
  });

  test('P3-36a: a variation is an img2img loopback at the final size: each loop repaints the whole image, details faces, feeds the next', () => {
    const req = request({ quality: 'high', shape: 'portrait', initName: 'disgourd-vary-x.png', init: { denoise: 0.3 } });
    const out = comfy.buildWorkflow(req, cfg({ upscaler: 'u.pth', detailer: true, detector: 'd.pt', tier: 'medium', varyLoops: 3 }), { seed: 9 });
    const wf = out.workflow;
    const final = comfy.hiresLongSize(comfy.sizeFor('sdxl', 'standard', 'portrait', 'medium'), 'medium'); // P9-08: the long-edge hires size
    expect([out.width, out.height]).toEqual([final.width, final.height]);
    expect(out.loops).toBe(3);
    // Loop 1: the image, scaled to the final size, encoded, repainted at 0.3, detailed.
    expect(wf['1']).toEqual({ class_type: 'LoadImage', inputs: { image: 'disgourd-vary-x.png' } });
    expect(wf['2'].inputs).toMatchObject({ width: final.width, height: final.height, crop: 'center' });
    expect(wf['5']).toEqual({ class_type: 'VAEEncode', inputs: { pixels: ['2', 0], vae: ['4', 2] } });
    expect(wf['3'].inputs).toMatchObject({ seed: 9, denoise: 0.3, latent_image: ['5', 0] });
    expect(wf['24']).toBeUndefined(); // no separate hires pass: the loops refine at full size
    expect(wf['41'].inputs).toMatchObject({ image: ['8', 0], max_size: 1024 });
    // P9-08: each loop ends in a Color Match back to the source picture.
    expect(wf['43']).toEqual({ class_type: 'ColorMatch', inputs: { image_ref: ['1', 0], image_target: ['41', 0], method: 'hm-mvgd-hm', strength: 1, multithread: true } });
    // Loops 2 and 3: from the previous loop's detailed, color-matched image, new seeds.
    expect(wf['110']).toEqual({ class_type: 'VAEEncode', inputs: { pixels: ['43', 0], vae: ['4', 2] } });
    expect(wf['111'].inputs).toMatchObject({ seed: 10, denoise: 0.3, latent_image: ['110', 0], model: ['4', 0] });
    expect(wf['112']).toEqual({ class_type: 'VAEDecode', inputs: { samples: ['111', 0], vae: ['4', 2] } });
    expect(wf['113'].inputs).toMatchObject({ image: ['112', 0], seed: 10 });
    expect(wf['114'].inputs).toMatchObject({ image_ref: ['1', 0], image_target: ['113', 0] });
    expect(wf['120'].inputs.pixels).toEqual(['114', 0]);
    expect(wf['121'].inputs).toMatchObject({ seed: 11 });
    expect(wf['9'].inputs.images).toEqual(['124', 0]);
    // Two loops by default; without the detailer a loop is encode → sample → decode.
    const plainLoops = comfy.buildWorkflow(request({ initName: 'v.png', init: { denoise: 0.5 } }), cfg()).workflow;
    expect(plainLoops['111'].inputs.denoise).toBe(0.5);
    expect(plainLoops['113']).toBeUndefined();
    expect(plainLoops['120']).toBeUndefined();
    expect(plainLoops['114'].inputs.image_target).toEqual(['112', 0]);
    expect(plainLoops['9'].inputs.images).toEqual(['114', 0]);
    // Flux in parts: its own VAE through every loop.
    const flux = comfy.buildWorkflow(request({ initName: 'v.png', init: { denoise: 0.5 } }), cfg({ kind: 'unet', model: UNETS[0], family: 'flux', clip1: CLIPS[0], clip2: CLIPS[1], vae: VAES[0] })).workflow;
    expect(flux['5'].inputs.vae).toEqual(['13', 0]);
    expect(flux['110'].inputs.vae).toEqual(['13', 0]);
    expect(flux['111'].inputs.positive).toEqual(['10', 0]);
    // Without an image: the empty latent at full strength, and no loops.
    const plain = comfy.buildWorkflow(request(), cfg()).workflow;
    expect(plain['5'].class_type).toBe('EmptyLatentImage');
    expect(plain['3'].inputs.denoise).toBe(1);
    expect(plain['1']).toBeUndefined();
    expect(plain['110']).toBeUndefined();
    // P9-08: the face is repainted at 1024 on every tier (it was 1024–2048 by tier); SD 1.5 stays small.
    for (const tier of ['low', 'medium', 'high']) {
      expect(comfy.buildWorkflow(request(), cfg({ tier, detailer: true, detector: 'd.pt' })).workflow['41'].inputs).toMatchObject({ guide_size: 1024, max_size: 1024 });
    }
    expect(comfy.buildWorkflow(request(), cfg({ family: 'sd15', detailer: true, detector: 'd.pt' })).workflow['41'].inputs).toMatchObject({ guide_size: 512, max_size: 768 });
    expect(comfy.validateConfig({ varyLoops: 5 }).error).toMatch(/1–4/);
    expect(comfy.validateConfig({ varyLoops: 3 })).toMatchObject({ varyLoops: 3 });
    expect(comfy.validateConfig({ varyStrong: 0.95 }).error).toMatch(/Strong variation strength is 0.3–0.9/);
    expect(comfy.validateConfig({ varySubtle: 0.05 }).error).toMatch(/Subtle variation strength is 0.1–0.6/);
    expect(comfy.validateConfig({ varySubtle: 0.25, varyStrong: 0.7 })).toMatchObject({ varySubtle: 0.25, varyStrong: 0.7 });
  });

  test('P3-36a: a variation uploads its image and runs end to end', async () => {
    await comfy.generate(request({ init: { buffer: PNG, contentType: 'image/png', ext: 'png', width: 1, height: 1, denoise: 0.3 } }), cfg());
    expect(seen.uploads.at(-1).name).toMatch(/^disgourd-vary-[a-f0-9]+\.png$/);
    expect(seen.prompts.at(-1)['1'].inputs.image).toBe(seen.uploads.at(-1).name);
    expect(seen.prompts.at(-1)['3'].inputs.denoise).toBe(0.3);
    expect(seen.prompts.at(-1)['111'].inputs.denoise).toBe(0.3); // the second loop
  });

  test('P3-36b: a custom image-to-image workflow: {{image}} and {{denoise}} filled; checked like the others', async () => {
    const IMG2IMG = { ...CUSTOM, 1: { class_type: 'LoadImage', inputs: { image: '{{image}}' } }, 3: { ...CUSTOM['3'], inputs: { ...CUSTOM['3'].inputs, denoise: '{{denoise}}' } } };
    expect(comfy.checkWorkflow(JSON.stringify(IMG2IMG), 'img2img').classTypes).toContain('LoadImage');
    expect(comfy.checkWorkflow(JSON.stringify(CUSTOM), 'img2img').error).toMatch(/needs \{\{image\}\}/);
    expect(comfy.validateConfig({ img2imgWorkflow: JSON.stringify(CUSTOM) }).error).toMatch(/^Image-to-image workflow: /);
    const init = { buffer: PNG, contentType: 'image/png', ext: 'png', width: 1, height: 1, denoise: 0.45 };
    await comfy.generate(request({ init }), cfg({ workflowMode: 'custom', workflow: CUSTOM, img2imgWorkflow: IMG2IMG }));
    const sent = seen.prompts.at(-1);
    expect(sent['1'].inputs.image).toBe(seen.uploads.at(-1).name);
    expect(sent['3'].inputs.denoise).toBe(0.45); // a number
    expect(sent['6'].inputs.text).toBe('masterpiece, a gourd in a hat');
    // My own without an image-to-image workflow: the built-in img2img.
    await comfy.generate(request({ init }), cfg({ workflowMode: 'custom', workflow: CUSTOM }));
    expect(seen.prompts.at(-1)['2'].class_type).toBe('ImageScale');
    expect(seen.prompts.at(-1)['3'].inputs.denoise).toBe(0.45);
  });

  test('P3-35: Anima: guessed by name, parts suggested, and the official graph (CLIPLoader stable_diffusion, 30 steps, CFG 4, er_sde, its own negative)', () => {
    expect(comfy.guessSplitFamily(String.raw`Anima\anima-preview3-base.safetensors`)).toBe('anima');
    expect(comfy.suggestParts('anima', [String.raw`Anima\qwen_3_06b_base.safetensors`, 'clip_l.safetensors', String.raw`zturbo\qwen_3_4b.safetensors`], [String.raw`Anima\qwen_image_vae.safetensors`, 'ae.safetensors']))
      .toEqual({ clip1: String.raw`Anima\qwen_3_06b_base.safetensors`, clip2: null, vae: String.raw`Anima\qwen_image_vae.safetensors` });
    const anima = cfg({ kind: 'unet', model: 'anima-preview3-base.safetensors', family: 'anima', clip1: 'qwen_3_06b_base.safetensors', vae: 'qwen_image_vae.safetensors' });
    const { workflow: wf } = comfy.buildWorkflow(request(), anima);
    expect(wf['11']).toEqual({ class_type: 'UNETLoader', inputs: { unet_name: 'anima-preview3-base.safetensors', weight_dtype: 'default' } });
    expect(wf['12']).toEqual({ class_type: 'CLIPLoader', inputs: { clip_name: 'qwen_3_06b_base.safetensors', type: 'stable_diffusion' } });
    expect(wf['13']).toEqual({ class_type: 'VAELoader', inputs: { vae_name: 'qwen_image_vae.safetensors' } });
    expect(wf['5'].class_type).toBe('EmptyLatentImage');
    expect(wf['3'].inputs).toMatchObject({ steps: 30, cfg: 4, sampler_name: 'er_sde', scheduler: 'simple', model: ['11', 0], positive: ['6', 0] });
    expect(wf['14']).toBeUndefined(); // no AuraFlow sampling (that's Z-Image)
    expect(wf['10']).toBeUndefined(); // no Flux guidance
    expect(wf['7'].inputs.text).toBe('worst quality, low quality, score_1, score_2, score_3, blurry, jpeg artifacts, sepia, nsfw, nude, nudity');
    expect(comfy.buildWorkflow(request(), anima, { permissive: true }).workflow['7'].inputs.text).toBe('worst quality, low quality, score_1, score_2, score_3, blurry, jpeg artifacts, sepia');
    expect(comfy.buildWorkflow(request(), { ...anima, negative: 'bad hands' }).workflow['7'].inputs.text).toBe('bad hands, nsfw, nude, nudity');
    expect(comfy.validateConfig({ kind: 'checkpoint', model: 'x.safetensors', family: 'anima' }).error).toMatch(/separate parts, not a checkpoint/);
    expect(flatCfg({ kind: 'unet', model: 'anima-preview3-base.safetensors', family: 'anima' })).toMatchObject({ family: 'anima' });
  });

  test('P3-24: config for a split model needs its type and parts; Z-Image is split only', () => {
    expect(comfy.validateConfig({ kind: 'disk' }).error).toMatch(/Unknown model kind/);
    expect(comfy.validateConfig({ kind: 'unet', model: UNETS[2] }).error).toMatch(/pick its type: Flux, Z-Image Turbo or Anima/);
    expect(comfy.validateConfig({ kind: 'unet', model: UNETS[0], family: 'sdxl' }).error).toMatch(/pick its type/);
    expect(comfy.validateConfig({ kind: 'checkpoint', model: MODELS[1], family: 'zimage' }).error).toMatch(/separate parts, not a checkpoint/);
    expect(comfy.validateConfig({ enabled: true, url: mockUrl, kind: 'unet', model: UNETS[0], clip1: CLIPS[0], vae: VAES[0] }).error).toMatch(/both text encoders and the VAE/);
    expect(comfy.validateConfig({ enabled: true, url: mockUrl, kind: 'unet', model: UNETS[1], vae: VAES[1] }).error).toMatch(/the text encoder and the VAE/);
    expect(comfy.validateConfig({ clip1: 42 }).error).toMatch(/from the lists/);
    expect(flatCfg({ enabled: true, url: mockUrl, kind: 'unet', model: UNETS[1], clip1: CLIPS[2], vae: VAES[1] })).toEqual({
      enabled: true, url: mockUrl, kind: 'unet', model: UNETS[1], family: 'zimage', clip1: CLIPS[2], vae: VAES[1], tier: 'medium',
    });
  });

  // ---- P9-08: the owner's workflow ----
  test('P9-08: SDXL at High: CLIP skip 2, a 1024×1536 base image (15 steps, CFG 5), hires to 1368×2048 (15 at 0.45), the owner’s detailer with SAM, Color Match to the base image', () => {
    const on = cfg({ upscaler: '4x-AnimeSharp.pth', detailer: true, detector: 'bbox/face_yolov8m.pt', sam: 'sam_vit_b_01ec64.pth', tier: 'high' });
    const { workflow: wf, width, height } = comfy.buildWorkflow(request({ quality: 'high', shape: 'portrait' }), on, { seed: 4 });
    expect(wf['15']).toEqual({ class_type: 'CLIPSetLastLayer', inputs: { clip: ['4', 1], stop_at_clip_layer: -2 } });
    expect(wf['6'].inputs.clip).toEqual(['15', 0]);
    expect(wf['7'].inputs.clip).toEqual(['15', 0]);
    expect(wf['5'].inputs).toMatchObject({ width: 1024, height: 1536 });
    expect(wf['3'].inputs).toMatchObject({ steps: 15, cfg: 5, sampler_name: 'dpmpp_2m', scheduler: 'karras', denoise: 1 });
    expect([width, height]).toEqual([1368, 2048]);
    expect(wf['22'].inputs).toMatchObject({ width: 1368, height: 2048 });
    expect(wf['24'].inputs).toMatchObject({ steps: 15, denoise: 0.45, cfg: 5, sampler_name: 'dpmpp_2m', scheduler: 'karras', seed: 4 });
    expect(wf['42']).toEqual({ class_type: 'SAMLoader', inputs: { model_name: 'sam_vit_b_01ec64.pth', device_mode: 'AUTO' } });
    expect(wf['41'].inputs).toMatchObject({
      image: ['25', 0], clip: ['15', 0], sam_model_opt: ['42', 0], bbox_detector: ['40', 0],
      guide_size: 1024, guide_size_for: true, max_size: 1024, steps: 30, cfg: 5, sampler_name: 'ddim', scheduler: 'simple', denoise: 0.3,
      feather: 5, noise_mask: true, force_inpaint: true, bbox_threshold: 0.5, bbox_dilation: 10, bbox_crop_factor: 3,
      sam_detection_hint: 'center-1', sam_dilation: 0, sam_threshold: 0.93, sam_bbox_expansion: 0, sam_mask_hint_threshold: 0.7, sam_mask_hint_use_negative: 'False', drop_size: 10, cycle: 3,
    });
    expect(wf['43']).toEqual({ class_type: 'ColorMatch', inputs: { image_ref: ['8', 0], image_target: ['41', 0], method: 'hm-mvgd-hm', strength: 1, multithread: true } });
    expect(wf['9'].inputs.images).toEqual(['43', 0]);
    // Standard: the base image, the detailer and Color Match; no hires.
    const std = comfy.buildWorkflow(request({ shape: 'portrait' }), on).workflow;
    expect(std['24']).toBeUndefined();
    expect(std['5'].inputs).toMatchObject({ width: 1024, height: 1536 });
    expect(std['41'].inputs.image).toEqual(['8', 0]);
    expect(std['9'].inputs.images).toEqual(['43', 0]);
    // Draft: about 1 MP, 10 steps, nothing else.
    const draft = comfy.buildWorkflow(request({ quality: 'draft', shape: 'portrait' }), on);
    expect([draft.width, draft.height]).toEqual([832, 1216]);
    expect(draft.workflow['3'].inputs.steps).toBe(10);
    for (const k of ['24', '41', '42', '43']) expect(draft.workflow[k]).toBeUndefined();
    expect(draft.workflow['9'].inputs.images).toEqual(['8', 0]);
  });

  test('P9-08: CLIP skip, saved overrides, other families, and the new settings', () => {
    // CLIP skip 1 (a style's choice) drops the node; split models and SD 1.5 don't get it by default.
    const one = comfy.buildWorkflow(request(), cfg({ clipSkip: 1 })).workflow;
    expect(one['15']).toBeUndefined();
    expect(one['6'].inputs.clip).toEqual(['4', 1]);
    expect(comfy.buildWorkflow(request(), cfg({ family: 'sd15' })).workflow['15']).toBeUndefined();
    expect(comfy.buildWorkflow(request(), cfg({ family: 'sd15', clipSkip: 2 })).workflow['15'].inputs.stop_at_clip_layer).toBe(-2);
    const flux = comfy.buildWorkflow(request({ quality: 'high' }), cfg({ kind: 'unet', model: UNETS[0], family: 'flux', clip1: CLIPS[0], clip2: CLIPS[1], vae: VAES[0], clipSkip: 2, upscaler: 'u.pth', detailer: true, detector: 'd.pt' })).workflow;
    expect(flux['15']).toBeUndefined();
    expect(flux['41'].inputs).toMatchObject({ cfg: 1, sampler_name: 'euler', guide_size: 1024, max_size: 1024 }); // its own sampling, the new crop
    // Saved values still win: steps, CFG, sampler, hires steps and strength, detailer strength and passes.
    const mine = comfy.buildWorkflow(request({ quality: 'high' }), cfg({ steps: { high: 36 }, cfgScale: 6, sampler: 'euler', hiresSteps: 20, hiresDenoise: 0.5, upscaler: 'u.pth', detailer: true, detector: 'd.pt', detailerDenoise: 0.4, detailerPasses: 2 })).workflow;
    expect(mine['3'].inputs).toMatchObject({ steps: 36, cfg: 6, sampler_name: 'euler' });
    expect(mine['24'].inputs).toMatchObject({ steps: 20, denoise: 0.5 });
    expect(mine['41'].inputs).toMatchObject({ denoise: 0.4, cycle: 2, sampler_name: 'ddim', cfg: 5 }); // the detailer's own sampling stays
    // Color Match can be absent (no KJNodes): the detailer's image is saved.
    expect(comfy.buildWorkflow(request(), cfg({ detailer: true, detector: 'd.pt', colorMatch: false })).workflow['9'].inputs.images).toEqual(['41', 0]);
    // Settings: CLIP skip 1–2, hires steps 1–150 (both a style's), hires strength 0.1–0.8 (shared).
    expect(comfy.validateConfig({ clipSkip: 3 }).error).toBe('CLIP skip is 1 or 2');
    expect(comfy.validateConfig({ hiresSteps: 0 }).error).toBe('Hires steps are 1–150');
    expect(comfy.validateConfig({ hiresDenoise: 0.9 }).error).toBe('The hires strength is 0.1–0.8');
    const saved = comfy.validateConfig({ presets: [{ id: 'a', name: 'A', model: MODELS[1], clipSkip: 1, hiresSteps: 18 }, { id: 'b', name: 'B', model: MODELS[1] }], defaultPreset: 'a', hiresDenoise: 0.5 });
    expect(saved.error).toBeUndefined();
    expect(saved.presets[0]).toMatchObject({ clipSkip: 1, hiresSteps: 18 });
    expect(saved.presets[1].clipSkip).toBeUndefined();
    expect(saved.hiresDenoise).toBe(0.5);
    expect(comfy.styleConfig(saved, 'a').config).toMatchObject({ clipSkip: 1, hiresSteps: 18, hiresDenoise: 0.5 });
    expect(comfy.publicConfig(saved)).toMatchObject({ clipSkip: 1, hiresSteps: 18, hiresDenoise: 0.5, detailerPasses: 3, detailerDenoise: 0.3 });
  });

  test('P9-08: generating finds the SAM model; without SAM, KJNodes or WAS the step is left out and noted', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      comfy.nodeCache.clear();
      comfy.samCache.clear();
      let out = await comfy.generate(request(), cfg({ detailer: true, detector: 'bbox/face_yolov8m.pt' }));
      expect(seen.prompts.at(-1)['42'].inputs.model_name).toBe('sam_vit_b_01ec64.pth'); // sam_vit_b preferred
      expect(seen.prompts.at(-1)['9'].inputs.images).toEqual(['43', 0]);
      expect(out.notes).toEqual([]);
      const tiled = await comfy.generate(request({ upscale: { buffer: PNG, width: 512, height: 512, factor: 2 } }), cfg({ upscaler: 'u.pth', upscaleMode: 'tiled' }));
      expect(seen.prompts.at(-1)['9'].inputs.images).toEqual(['51', 0]);
      expect(tiled.notes).toEqual([]);
      hasExtras = false;
      comfy.nodeCache.clear();
      comfy.samCache.clear();
      out = await comfy.generate(request(), cfg({ detailer: true, detector: 'bbox/face_yolov8m.pt' }));
      expect(seen.prompts.at(-1)['42']).toBeUndefined();
      expect('sam_model_opt' in seen.prompts.at(-1)['41'].inputs).toBe(false);
      expect(seen.prompts.at(-1)['9'].inputs.images).toEqual(['41', 0]);
      expect(out.notes).toEqual(['faces found without SAM: ComfyUI is missing SAMLoader', 'made without Color Match: ComfyUI is missing ColorMatch']);
      const plain = await comfy.generate(request({ upscale: { buffer: PNG, width: 512, height: 512, factor: 2 } }), cfg({ upscaler: 'u.pth', upscaleMode: 'tiled' }));
      expect(seen.prompts.at(-1)['9'].inputs.images).toEqual(['30', 0]);
      expect(plain.notes).toEqual(['made without Color Match: ComfyUI is missing ColorMatch', 'upscaled without the saturation lift: ComfyUI is missing Image Filter Adjustments']);
    } finally {
      hasExtras = true;
      comfy.nodeCache.clear();
      warn.mockRestore();
    }
  });

  test('SD 1.5 / SDXL workflows: checkpoint, sizes, sampler, and the negative nudge only outside 18+', () => {
    const { workflow, width, height } = comfy.buildWorkflow(request(), cfg());
    expect(workflow['4'].inputs.ckpt_name).toBe(MODELS[1]);
    // P9-08: the High tier's 1216 square, 15 steps, CFG 5.
    expect(workflow['5']).toMatchObject({ class_type: 'EmptyLatentImage', inputs: { width: 1216, height: 1216 } });
    expect([width, height]).toEqual([1216, 1216]);
    expect(workflow['3'].inputs).toMatchObject({ steps: 15, cfg: 5, sampler_name: 'dpmpp_2m', scheduler: 'karras' });
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
    expect(out).toMatchObject({ model: MODELS[1], width: 1216, height: 1216 });
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
    expect(flatCfg({ enabled: true, url: 'http://192.168.1.20:8188/', model: MODELS[0] })).toEqual({
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
        body: JSON.stringify({ username: name, password: 'gourd-test-pass-1', email: `${name}@example.com` }),
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
    const { presets, defaultPreset, ...flatPublic } = saved.body.engines.find((e) => e.id === 'comfyui').config;
    expect(presets).toEqual([expect.objectContaining({ id: 'default', name: 'Default', model: MODELS[0] })]);
    expect(defaultPreset).toBe('default');
    expect(flatPublic).toEqual({ enabled: true, url: mockUrl, model: MODELS[0], family: 'flux', tier: 'high', kind: 'checkpoint', clip1: null, clip2: null, vae: null, hires: true, upscaler: null, hiresDenoise: 0.45, clipSkip: null, hiresSteps: null, upscaleMode: 'model', tileDenoise: 0.2, tileSize: 1280,
      sampler: null, scheduler: null, cfgScale: null, steps: null, negative: null, detailer: false, detector: null, detailerDenoise: 0.3, detailerPasses: 3, tilePasses: 1, varyLoops: 2, varySubtle: 0.3, varyStrong: 0.65,
      workflowMode: 'builtin', workflow: '', upscaleWorkflow: '', img2imgWorkflow: '', promptPrefix: '' });
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

  test('P3-36a: Subtle and Strong variations: img2img from the image, posted for the presser; varied and upscaled images too; Retry; refusals', async () => {
    const S = 'Comfy Club';
    const { channelId } = db.channelRef(S, 'general');
    const spaceId = db.getSpaceByName(S).id;
    await call('admin', 'PUT', '/admin/imagine', { engines: { comfyui: { enabled: true, url: mockUrl, model: MODELS[1], family: 'sdxl', upscaler: '4x-UltraSharp.pth', upscaleMode: 'model' } }, defaultEngine: 'comfyui' });
    await call('admin', 'PATCH', `/spaces/${encodeURIComponent(S)}/imagine`, { dailyLimit: 100 });
    const finished = (kind = 'generate', status = 'done', strength = null) => {
      const token = require('crypto').randomBytes(9).toString('hex');
      fs.mkdirSync(path.join(UPLOADS, token), { recursive: true });
      fs.writeFileSync(path.join(UPLOADS, token, 'disgourd-x.png'), PNG);
      const url = `/uploads/${token}/disgourd-x.png`;
      const msg = db.postAsBot(S, 'general', '🎨 **pat** imagined: a gourd in the rain');
      db.updateBotMessage(Number(msg.id), '🎨 **pat** imagined: a gourd in the rain', [url]);
      const id = db.createImagineJob({ userId: users.admin.id, spaceId, channelId, engine: 'kie', prompt: 'a gourd in the rain', shape: 'portrait', quality: 'standard', kind, sourceUrl: kind === 'vary' ? url : null, strength });
      db.updateImagineJob(id, { messageId: Number(msg.id), status });
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
      expect((await call('admin', 'GET', '/spaces')).body.find((s) => s.name === S).imagine.canVary).toBe(true);
      // A kie.ai image, varied subtly on ComfyUI: img2img at 0.35, same prompt and shape.
      const src = finished();
      const used = db.countImagineJobsSince(users.admin.id, 0);
      const subtle = await ask({ from: src.messageId, vary: 'subtle' });
      expect(db.getImagineJob(subtle.jobId)).toMatchObject({ kind: 'vary', engine: 'comfyui', strength: 0.3, source_url: src.url, prompt: 'a gourd in the rain', shape: 'portrait' });
      expect(db.countImagineJobsSince(users.admin.id, 0)).toBe(used + 1);
      expect((await settle(subtle.jobId)).status).toBe('done');
      expect(seen.prompts.at(-1)['3'].inputs.denoise).toBe(0.3);
      expect(seen.prompts.at(-1)['111'].inputs.seed).toBe(seen.prompts.at(-1)['3'].inputs.seed + 1); // loop 2, a new seed
      expect(seen.prompts.at(-1)['1'].inputs.image).toMatch(/^disgourd-vary-/);
      expect(db.raw.prepare('SELECT content FROM messages WHERE id = ?').get(subtle.messageId).content).toBe('🎲 **admin** varied (subtle): a gourd in the rain');
      // Strong, from the variation itself, and from an upscaled image.
      const strong = await ask({ from: subtle.messageId, vary: 'strong' });
      expect(db.getImagineJob(strong.jobId)).toMatchObject({ kind: 'vary', strength: 0.65 });
      await settle(strong.jobId);
      expect(seen.prompts.at(-1)['3'].inputs.denoise).toBe(0.65);
      // The host's own strengths, from Settings.
      await call('admin', 'PUT', '/admin/imagine', { engines: { comfyui: { varySubtle: 0.2, varyStrong: 0.8 } } });
      const custom = await ask({ from: src.messageId, vary: 'strong' });
      expect(db.getImagineJob(custom.jobId)).toMatchObject({ strength: 0.8 });
      await settle(custom.jobId);
      expect(db.raw.prepare('SELECT content FROM messages WHERE id = ?').get(custom.messageId).content).toMatch(/varied \(strong\)/);
      await call('admin', 'PUT', '/admin/imagine', { engines: { comfyui: { varySubtle: 0.3, varyStrong: 0.65 } } });
      const up = finished('upscale');
      expect(await ask({ from: up.messageId, vary: 'subtle' })).toMatchObject({ messageId: expect.any(Number) });
      await new Promise((r) => setTimeout(r, 300));
      // A failed variation retries as one, with its strength.
      const failed = finished('vary', 'failed', 0.6);
      const retry = await ask({ from: failed.messageId });
      expect(db.getImagineJob(retry.jobId)).toMatchObject({ kind: 'vary', strength: 0.6, source_url: failed.url });
      await settle(retry.jobId);
      // Refused: a failed generate (nothing to vary), and without ComfyUI.
      expect(await ask({ from: finished('generate', 'failed').messageId, vary: 'subtle' })).toBe('NOT_FOUND');
      await call('admin', 'PUT', '/admin/imagine', { engines: { comfyui: { enabled: false } } });
      expect(await ask({ from: src.messageId, vary: 'strong' })).toBe('NO_ENGINE');
    } finally {
      ws.close();
      await call('admin', 'PUT', '/admin/imagine', { engines: { comfyui: { enabled: true } } });
    }
  });

  test('P3-36b: starting /imagine from a picture: an upload or the replied-to image, a strength, the shape from the picture; refusals; Retry', async () => {
    const S = 'Comfy Club';
    await call('admin', 'PUT', '/admin/imagine', { engines: { comfyui: { enabled: true, url: mockUrl, model: MODELS[1], family: 'sdxl', varySubtle: 0.3, varyStrong: 0.65 } }, defaultEngine: 'comfyui' });
    await call('admin', 'PATCH', `/spaces/${encodeURIComponent(S)}/imagine`, { dailyLimit: 100 });
    // A person's upload (a name with spaces), 1200×800 → landscape.
    const token = require('crypto').randomBytes(9).toString('hex');
    fs.mkdirSync(path.join(UPLOADS, token), { recursive: true });
    const head = Buffer.alloc(33);
    head.writeUInt32BE(0x89504e47, 0);
    head.writeUInt32BE(1200, 16);
    head.writeUInt32BE(800, 20);
    fs.writeFileSync(path.join(UPLOADS, token, 'My Photo.png'), head);
    const upload = `/uploads/${token}/${encodeURIComponent('My Photo.png')}`;
    const frames = [];
    const ws = new WebSocket(`ws://localhost:${port}/gateway?token=${users.admin.token}`);
    ws.on('message', (raw) => frames.push(JSON.parse(raw.toString())));
    await new Promise((r) => ws.on('open', r));
    const ask = async (fields, channel = 'general') => {
      const from = frames.length;
      ws.send(JSON.stringify({ op: 'imagine', space: S, channel, prompt: 'make it a watercolor', quality: 'standard', ...fields }));
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
      const used = db.countImagineJobsSince(users.admin.id, 0);
      const fromUpload = await ask({ init: { url: upload, strength: 'medium' } });
      expect(db.getImagineJob(fromUpload.jobId)).toMatchObject({ kind: 'img2img', engine: 'comfyui', strength: 0.48, source_url: upload, shape: 'landscape', prompt: 'make it a watercolor' });
      expect(db.countImagineJobsSince(users.admin.id, 0)).toBe(used + 1);
      await settle(fromUpload.jobId);
      expect(seen.prompts.at(-1)['3'].inputs.denoise).toBe(0.48);
      expect(seen.prompts.at(-1)['1'].inputs.image).toMatch(/^disgourd-vary-/);
      // The picture in a message being replied to, in this channel.
      const msg = db.storeMessage(S, 'general', 'look at this', users.admin.id, [upload]);
      const fromReply = await ask({ init: { messageId: Number(msg.id), strength: 'strong' } });
      expect(db.getImagineJob(fromReply.jobId)).toMatchObject({ kind: 'img2img', strength: 0.65, source_url: upload });
      await settle(fromReply.jobId);
      // Refused: a bad strength, no picture, another channel's message, a path outside uploads.
      expect(await ask({ init: { url: upload, strength: 'max' } })).toBe('BAD_OPTION');
      expect(await ask({ init: { messageId: Number(db.storeMessage(S, 'general', 'words only', users.admin.id).id), strength: 'subtle' } })).toBe('NOT_FOUND');
      db.createChannel(S, 'other-room');
      const elsewhere = db.storeMessage(S, 'other-room', 'pic', users.admin.id, [upload]);
      expect(await ask({ init: { messageId: Number(elsewhere.id), strength: 'subtle' } })).toBe('NOT_FOUND');
      expect(await ask({ init: { url: `/uploads/${token}/..%2F..%2Fsecret.png`, strength: 'subtle' } })).toBe('NOT_FOUND');
      // A failed one retries from the same picture and strength.
      db.updateImagineJob(fromReply.jobId, { status: 'failed' });
      const retry = await ask({ from: fromReply.messageId });
      expect(db.getImagineJob(retry.jobId)).toMatchObject({ kind: 'img2img', strength: 0.65, source_url: upload, prompt: 'make it a watercolor' });
      await settle(retry.jobId);
      // Without ComfyUI: refused.
      await call('admin', 'PUT', '/admin/imagine', { engines: { comfyui: { enabled: false } } });
      expect(await ask({ init: { url: upload, strength: 'subtle' } })).toBe('NO_ENGINE');
    } finally {
      ws.close();
      await call('admin', 'PUT', '/admin/imagine', { engines: { comfyui: { enabled: true } } });
    }
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

  test('P3-34: saving a custom workflow checks its nodes on that ComfyUI; chat then uses it', async () => {
    const put = (comfyui) => call('admin', 'PUT', '/admin/imagine', { engines: { comfyui } });
    const unknown = { ...CUSTOM, 70: { class_type: 'MyCustomSampler', inputs: {} }, 71: { class_type: 'OtherNode', inputs: {} } };
    expect((await put({ url: mockUrl, workflowMode: 'custom', workflow: JSON.stringify(unknown) })).body)
      .toEqual({ error: 'Workflow: your ComfyUI doesn’t have these nodes: MyCustomSampler, OtherNode' });
    expect((await put({ workflowMode: 'custom', workflow: '{"nodes": []}' })).body.error).toMatch(/^Workflow: That’s the regular workflow file/);
    expect((await put({ workflow: JSON.stringify(CUSTOM), upscaleWorkflow: JSON.stringify({ 1: { class_type: 'LoadImage', inputs: { image: '{{image}}' } }, 2: { class_type: 'Nope', inputs: {} } }) })).body.error)
      .toBe('Upscale workflow: your ComfyUI doesn’t have this node: Nope');
    const saved = await put({ enabled: true, url: mockUrl, workflowMode: 'custom', workflow: JSON.stringify(CUSTOM), upscaleWorkflow: '' });
    expect(saved.status).toBe(200);
    expect(saved.body.engines.find((e) => e.id === 'comfyui').config).toMatchObject({ workflowMode: 'custom', workflow: JSON.stringify(CUSTOM, null, 2), upscaleWorkflow: '' });
    // The test image and chat both run it (two outputs → two images).
    const tried = await call('admin', 'POST', '/admin/imagine/try', { engine: 'comfyui', prompt: 'a gourd' });
    expect(tried.status).toBe(200);
    expect(seen.prompts.at(-1)['6'].inputs.text).toBe('masterpiece, a gourd');
    await put({ workflowMode: 'builtin' }); // back to the built-in one for the rest
    expect(seen.prompts.length).toBeGreaterThan(0);
  });
  test('P9-04a: style presets: an old config reads as one "Default" style; the list is checked; each style runs its own model, sampler and prefix', () => {
    // An old single setup becomes the "Default" style; nothing is lost.
    const old = { enabled: true, url: mockUrl, tier: 'high', model: MODELS[1], family: 'sdxl', sampler: 'euler', negative: 'blurry' };
    const n = comfy.normalizeConfig(old);
    expect(n.presets).toEqual([{ id: 'default', name: 'Default', model: MODELS[1], family: 'sdxl', sampler: 'euler', negative: 'blurry' }]);
    expect(n).toMatchObject({ defaultPreset: 'default', tier: 'high', url: mockUrl });
    expect(n.model).toBeUndefined();
    // The older flat fields still edit the default style (the settings screen until P9-04b).
    const flatSaved = comfy.validateConfig({ sampler: 'dpmpp_2m' }, old);
    expect(flatSaved.presets[0]).toMatchObject({ id: 'default', sampler: 'dpmpp_2m', model: MODELS[1] });
    // A list of styles: names checked, ids made, the default kept or picked.
    const two = comfy.validateConfig({ presets: [
      { id: 'default', name: 'Photoreal', model: MODELS[1], family: 'sdxl' },
      { name: 'Anime Art', model: MODELS[2], family: 'sd15', sampler: 'euler_ancestral', promptPrefix: ' anime screencap, ' },
    ], defaultPreset: 'default' }, old);
    expect(two.error).toBeUndefined();
    expect(two.presets.map((p) => [p.id, p.name])).toEqual([['default', 'Photoreal'], ['anime-art', 'Anime Art']]);
    expect(two.presets[1].promptPrefix).toBe('anime screencap, ');
    expect(two.defaultPreset).toBe('default');
    expect(comfy.validateConfig({ presets: [] }, old).error).toMatch(/at least one style/);
    expect(comfy.validateConfig({ presets: [{ name: '' }] }, old).error).toMatch(/1–30/);
    expect(comfy.validateConfig({ presets: [{ name: 'A', model: MODELS[1] }, { name: 'a', model: MODELS[1] }] }, old).error).toMatch(/two styles called/);
    expect(comfy.validateConfig({ presets: [{ name: 'A', model: MODELS[1] }], defaultPreset: 'nope' }, old).error).toMatch(/default/);
    expect(comfy.validateConfig({ presets: [{ name: 'Mine', workflowMode: 'custom' }, { name: 'B', model: MODELS[1] }] }, old).error).toBe('Mine: Add your workflow (Export (API) in ComfyUI) before choosing My own');
    expect(comfy.validateConfig({ presets: [{ name: 'Long', model: MODELS[1], promptPrefix: 'x'.repeat(301) }] }, old).error).toMatch(/300/);
    // Each style runs with the shared settings plus its own.
    const anime = comfy.styleConfig(two, 'anime-art');
    expect(anime.config).toMatchObject({ tier: 'high', url: mockUrl, model: MODELS[2], family: 'sd15', sampler: 'euler_ancestral' });
    expect(anime.fellBack).toBe(false);
    expect(comfy.styleConfig(two, 'gone')).toMatchObject({ fellBack: true, preset: { id: 'default' } });
    expect(comfy.styleConfig(two).preset.id).toBe('default');
    expect(comfy.styleList(two)).toEqual({ styles: [{ id: 'default', name: 'Photoreal' }, { id: 'anime-art', name: 'Anime Art' }], defaultStyle: 'default' });
    // The public view: the default's fields flat (as before) plus every style.
    const pub = comfy.publicConfig(two);
    expect(pub).toMatchObject({ model: MODELS[1], defaultPreset: 'default' });
    expect(pub.presets[1]).toMatchObject({ id: 'anime-art', name: 'Anime Art', model: MODELS[2], promptPrefix: 'anime screencap,' });
  });

  test('P9-04a: in chat, a style is chosen, defaulted or refused; the job keeps it; Variations reuse it; a deleted style falls back', async () => {
    const S = 'Style Club';
    db.createSpaceWithDefaults(S, users.admin.id);
    await call('admin', 'PATCH', `/spaces/${encodeURIComponent(S)}/imagine`, { enabled: true, dailyLimit: 100 });
    const saved = await call('admin', 'PUT', '/admin/imagine', { engines: { comfyui: { enabled: true, url: mockUrl, upscaler: '4x-UltraSharp.pth', presets: [
      { id: 'photo', name: 'Photoreal', model: MODELS[1], family: 'sdxl', sampler: 'euler' },
      { id: 'anime', name: 'Anime', model: MODELS[2], family: 'sd15', sampler: 'euler_ancestral', promptPrefix: 'anime screencap,' },
    ], defaultPreset: 'photo' } }, defaultEngine: 'comfyui' });
    expect(saved.status).toBe(200);
    const info = (await call('admin', 'GET', '/spaces')).body.find((s) => s.name === S).imagine;
    expect(info.styles).toEqual([{ id: 'photo', name: 'Photoreal' }, { id: 'anime', name: 'Anime' }]);
    expect(info.defaultStyle).toBe('photo');
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
    const graph = () => seen.prompts.at(-1);
    try {
      expect(await ask({ prompt: 'a gourd', preset: 'nope' })).toBe('BAD_OPTION');
      // Anime: its model, sampler and prefix; the job remembers the style.
      const a = await ask({ prompt: 'a gourd at dusk', preset: 'anime' });
      const aJob = await settle(a.jobId);
      expect(aJob).toMatchObject({ status: 'done', preset: 'anime', model: MODELS[2], prompt: 'a gourd at dusk' });
      expect(graph()['4'].inputs.ckpt_name).toBe(MODELS[2]);
      expect(graph()['3'].inputs.sampler_name).toBe('euler_ancestral');
      expect(graph()['6'].inputs.text).toBe('anime screencap, a gourd at dusk');
      // P9-04c: with more than one style, the message names it (not the prefix).
      const said = (id) => db.raw.prepare('SELECT content FROM messages WHERE id = ?').get(id).content;
      expect(said(aJob.message_id)).toBe('🎨 **admin** imagined (Anime): a gourd at dusk');
      // No style asked: the default.
      const p = await ask({ prompt: 'a gourd at noon' });
      expect(await settle(p.jobId)).toMatchObject({ preset: 'photo', model: MODELS[1] });
      expect(graph()['6'].inputs.text).toBe('a gourd at noon');
      // A Variation of the Anime image keeps Anime, whatever the default.
      const v = await ask({ from: aJob.message_id, vary: 'subtle' });
      expect(await settle(v.jobId)).toMatchObject({ kind: 'vary', preset: 'anime', model: MODELS[2] });
      expect(said(v.messageId)).toBe('🎲 **admin** varied (subtle, Anime): a gourd at dusk');
      expect(graph()['6'].inputs.text).toBe('anime screencap, a gourd at dusk');
      // Anime is deleted: a Variation of its image falls back to the default.
      await call('admin', 'PUT', '/admin/imagine', { engines: { comfyui: { presets: [{ id: 'photo', name: 'Photoreal', model: MODELS[1], family: 'sdxl', sampler: 'euler' }], defaultPreset: 'photo' } } });
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const v2 = await ask({ from: aJob.message_id, vary: 'strong' });
      expect(await settle(v2.jobId)).toMatchObject({ preset: 'photo', model: MODELS[1] });
      expect(said(v2.messageId)).toBe('🎲 **admin** varied (strong): a gourd at dusk'); // one style left: not named
      expect(warn.mock.calls.flat().join(' ')).toMatch(/the style "anime" is gone; used "Photoreal"/);
      warn.mockRestore();
    } finally {
      ws.close();
    }
  });

  test('P9-04a: each style’s own workflows are checked for nodes on save, named by style', async () => {
    const put = (comfyui) => call('admin', 'PUT', '/admin/imagine', { engines: { comfyui } });
    const unknown = { ...CUSTOM, 70: { class_type: 'MyCustomSampler', inputs: {} } };
    const res = await put({ url: mockUrl, presets: [
      { id: 'photo', name: 'Photoreal', model: MODELS[1], family: 'sdxl' },
      { name: 'Mine', workflowMode: 'custom', workflow: JSON.stringify(unknown) },
    ], defaultPreset: 'photo' });
    expect(res.body).toEqual({ error: 'Mine: Workflow: your ComfyUI doesn’t have this node: MyCustomSampler' });
    const ok = await put({ url: mockUrl, presets: [
      { id: 'photo', name: 'Photoreal', model: MODELS[1], family: 'sdxl' },
      { name: 'Mine', workflowMode: 'custom', workflow: JSON.stringify(CUSTOM) },
    ], defaultPreset: 'photo' });
    expect(ok.status).toBe(200);
    expect(ok.body.engines.find((e) => e.id === 'comfyui').config.presets.map((p) => [p.id, p.workflowMode])).toEqual([['photo', 'builtin'], ['mine', 'custom']]);
  });
});
