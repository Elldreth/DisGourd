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
      if (url.pathname === '/prompt' && req.method === 'POST') {
        const { prompt } = JSON.parse(body);
        seen.prompts.push(prompt);
        if (prompt['4'].inputs.ckpt_name === 'missing.safetensors') {
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
    expect(await comfy.listModels(mockUrl)).toEqual([
      { name: MODELS[0], family: 'flux' },
      { name: MODELS[1], family: 'sdxl' },
      { name: MODELS[2], family: 'sd15' },
    ]);
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
    expect(comfy.validateConfig({ family: 'sd3' }).error).toMatch(/SD 1.5, SDXL or Flux/);
    expect(comfy.validateConfig({ tier: 'huge' }).error).toMatch(/low, medium or high/);
    expect(comfy.validateConfig({ enabled: true }).error).toMatch(/pick a model/);
    expect(comfy.validateConfig({ enabled: true, url: 'http://192.168.1.20:8188/', model: MODELS[0] })).toEqual({
      enabled: true, url: 'http://192.168.1.20:8188', model: MODELS[0], family: 'flux', tier: 'medium',
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
    expect(ok.body).toMatchObject({ url: mockUrl, models: [{ family: 'flux' }, { family: 'sdxl' }, { family: 'sd15' }] });
  });

  test('saving the ComfyUI settings, a test image, and the always-refused check', async () => {
    expect((await call('admin', 'PUT', '/admin/imagine', { engines: { comfyui: { enabled: true } } })).body.error).toMatch(/pick a model/);
    const saved = await call('admin', 'PUT', '/admin/imagine', { engines: { comfyui: { enabled: true, url: mockUrl, model: MODELS[0], tier: 'high' } }, defaultEngine: 'comfyui' });
    expect(saved.body.engines.find((e) => e.id === 'comfyui').config).toEqual({ enabled: true, url: mockUrl, model: MODELS[0], family: 'flux', tier: 'high' });
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
