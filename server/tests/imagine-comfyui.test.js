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
const seen = { prompts: [], deleted: [], interrupts: 0 };
let promptCount = 0;
const promptsById = new Map();

function startMock() {
  mock = http.createServer((req, res) => {
    let body = '';
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
      if (url.pathname === '/prompt' && req.method === 'POST') {
        const { prompt } = JSON.parse(body);
        seen.prompts.push(prompt);
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
        promptsById.set(id, { text: prompt['6'].inputs.text, polls: 0 });
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
    });
    expect(all.upscalers).toEqual(UPSCALERS);
    // Another host's ComfyUI that can't list split parts: checkpoints only.
    partsListed = false;
    try {
      const old = await comfy.listAll(mockUrl);
      expect(old).toMatchObject({ models: MODELS.map((name) => ({ name, kind: 'checkpoint' })), clips: [], vaes: [], upscalers: [], suggested: { upscaler: null } });
    } finally {
      partsListed = true;
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
    expect(saved.body.engines.find((e) => e.id === 'comfyui').config).toEqual({ enabled: true, url: mockUrl, model: MODELS[0], family: 'flux', tier: 'high', kind: 'checkpoint', clip1: null, clip2: null, vae: null, hires: true, upscaler: null });
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
});
