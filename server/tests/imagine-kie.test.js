// P2-20c: the kie.ai engine against a mock kie.ai API — request bodies per
// model, polling, downloads, errors, the key handling, prices and the monthly
// credit cap.
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

let serverModule;
let db;
let kie;
let imagine;
let port;
let mock;
let mockUrl;
const UPLOADS = path.join(os.tmpdir(), `disgourd-test-uploads-kie-${process.pid}`);
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415408d763f8cfc0000003010100c9fe92ef0000000049454e44ae426082', 'hex');
const KEY = 'test-key-abcd1234';

const seen = { bodies: [], auth: [], polls: 0, uploads: [], failUpload: false };
const tasks = new Map(); // taskId -> { prompt, polls }
let taskCount = 0;

function startMock() {
  mock = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const json = (status, data) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(data));
      };
      const url = new URL(req.url, 'http://x');
      if (url.pathname === '/img/out.png') {
        res.writeHead(200, { 'content-type': 'image/png' });
        return res.end(PNG);
      }
      seen.auth.push(req.headers.authorization);
      if (req.headers.authorization !== `Bearer ${KEY}`) return json(200, { code: 401, msg: 'Unauthorized' });
      if (url.pathname === '/api/v1/chat/credit') return json(200, { code: 200, msg: 'success', data: 123.5 });
      // P9-05a: kie.ai's file storage (errors come back as HTTP 200 with a code).
      if (url.pathname === '/api/file-base64-upload') {
        const b = JSON.parse(raw);
        seen.uploads.push({ kind: 'base64', ...b });
        if (seen.failUpload) return json(200, { success: false, code: 500, msg: 'upload failed' });
        return json(200, { success: true, code: 200, data: { downloadUrl: `https://tempfile.example/kieai/${b.uploadPath}/${b.fileName}` } });
      }
      if (url.pathname === '/api/file-stream-upload') {
        seen.uploads.push({ kind: 'stream', type: req.headers['content-type'], size: raw.length });
        return json(200, { success: true, code: 200, data: { downloadUrl: 'https://tempfile.example/kieai/disgourd/big.png' } });
      }
      if (url.pathname === '/api/v1/jobs/createTask') {
        const body = JSON.parse(raw);
        seen.bodies.push(body);
        const p = body.input.prompt;
        if (p.includes('[402]')) return json(200, { code: 402, msg: 'Credits insufficient' });
        if (p.includes('[429]')) return json(429, { code: 429, msg: 'Too many requests' });
        const id = `t${++taskCount}`;
        tasks.set(id, { prompt: p, polls: 0 });
        return json(200, { code: 200, msg: 'success', data: { taskId: id } });
      }
      if (url.pathname === '/api/v1/jobs/recordInfo') {
        seen.polls += 1;
        const t = tasks.get(url.searchParams.get('taskId'));
        t.polls += 1;
        if (t.prompt.includes('[slow]') || t.polls < 2) return json(200, { code: 200, data: { state: 'generating' } });
        if (t.prompt.includes('[refuse]')) return json(200, { code: 200, data: { state: 'fail', failCode: '400', failMsg: 'Content flagged as sensitive by the safety filter', creditsConsumed: 0 } });
        if (t.prompt.includes('[broken]')) return json(200, { code: 200, data: { state: 'fail', failCode: '500', failMsg: 'internal error' } });
        // P13-02: kie.ai's own timeout, charged nothing; "[timeout-once]" only on the first task.
        if (t.prompt.includes('[timeout]') || (t.prompt.includes('[timeout-once]') && !seen.timedOutOnce)) {
          seen.timedOutOnce = true;
          return json(200, { code: 200, data: { state: 'fail', failCode: '501', failMsg: 'generate task timeout', creditsConsumed: 0 } });
        }
        if (t.prompt.includes('[odd]')) return json(200, { code: 200, data: { state: 'fail', failCode: '422', failMsg: 'prompt too long', creditsConsumed: 0 } });
        return json(200, { code: 200, data: { state: 'success', resultJson: JSON.stringify({ resultUrls: [`${mockUrl}/img/out.png`] }), creditsConsumed: 0.8, costTime: 3 } });
      }
      json(404, { code: 404, msg: 'not found' });
    });
  });
  return new Promise((r) => mock.listen(0, '127.0.0.1', () => r()));
}

beforeAll(async () => {
  process.env.PORT = 0;
  process.env.JWT_SECRET = 'disgourd-test-secret-0123456789abcdef';
  process.env.DB_PATH = ':memory:';
  process.env.UPLOADS_DIR = UPLOADS;
  process.env.IMAGINE_KIE_POLL_MS = '20';
  delete process.env.KIEAI_API_KEY;
  await startMock();
  mockUrl = `http://127.0.0.1:${mock.address().port}`;
  process.env.KIE_API_BASE = mockUrl;
  process.env.KIE_UPLOAD_BASE = mockUrl;
  serverModule = require('../server');
  db = serverModule.db;
  kie = require('../imagine/engines/kie');
  imagine = require('../imagine');
  await new Promise((r) => serverModule.httpServer.listen(0, r));
  port = serverModule.httpServer.address().port;
});
afterAll(async () => {
  serverModule.httpServer.closeAllConnections?.();
  await new Promise((r) => serverModule.httpServer.close(r));
  mock.closeAllConnections(); // fetch keeps connections alive; don't wait for them
  await new Promise((r) => mock.close(r));
});

const req = (over = {}) => ({ prompt: 'a gourd', shape: 'square', quality: 'standard', ...over });
const cfg = (over = {}) => ({ apiKey: KEY, model: 'z-image', ...over });

describe('requests per model', () => {
  test('shape, quality and the content-filter switch map onto each model', () => {
    expect(kie.buildInput(req(), cfg())).toEqual({ model: 'z-image', input: { prompt: 'a gourd', aspect_ratio: '1:1', nsfw_checker: true } });
    expect(kie.buildInput(req({ shape: 'landscape', quality: 'high' }), cfg({ model: 'flux-2/pro-text-to-image' })).input).toEqual({ prompt: 'a gourd', aspect_ratio: '3:2', resolution: '2K', nsfw_checker: true });
    expect(kie.buildInput(req({ shape: 'wide', quality: 'draft' }), cfg({ model: 'seedream/5-lite-text-to-image' })).input).toMatchObject({ aspect_ratio: '16:9', quality: 'basic', output_format: 'png' });
    expect(kie.buildInput(req({ shape: 'portrait' }), cfg({ model: 'grok-imagine/text-to-image' })).input.aspect_ratio).toBe('2:3');
    expect(kie.buildInput(req({ shape: 'portrait' }), cfg({ model: 'z-image' })).input.aspect_ratio).toBe('3:4'); // no 2:3 there
    const qwen = kie.buildInput(req({ shape: 'portrait', quality: 'high' }), cfg({ model: 'qwen/text-to-image' })).input;
    expect(qwen).toMatchObject({ image_size: 'portrait_4_3', num_inference_steps: 45, enable_safety_checker: true, nsfw_checker: true });
    expect(qwen.aspect_ratio).toBeUndefined();
    const nano = kie.buildInput(req(), cfg({ model: 'nano-banana-2' })).input;
    expect(nano).toMatchObject({ aspect_ratio: '1:1', resolution: '1K', output_format: 'png', image_input: [] });
    expect('nsfw_checker' in nano).toBe(false); // no switch: Google filters it
    expect(kie.buildInput(req({ shape: 'portrait' }), cfg({ model: 'custom', customModel: 'vendor/new-model' }))).toEqual({
      model: 'vendor/new-model', input: { prompt: 'a gourd', aspect_ratio: '3:4', nsfw_checker: true },
    });
  });

  test('permissive (an 18+ channel the instance allows) turns the switches off', () => {
    expect(kie.buildInput(req(), cfg(), { permissive: true }).input.nsfw_checker).toBe(false);
    expect(kie.buildInput(req(), cfg({ model: 'qwen/text-to-image' }), { permissive: true }).input).toMatchObject({ enable_safety_checker: false, nsfw_checker: false });
  });
});

describe('pictures (P9-05a)', () => {
  const init = (over = {}) => ({ buffer: PNG, ext: 'png', contentType: 'image/png', width: 1, height: 1, denoise: 0.3, ...over });
  const URL1 = 'https://tempfile.example/kieai/disgourd/p.png';
  test('each model’s picture version: the image field, aspect or auto, quality, the switches, and Qwen’s strength', () => {
    const pic = (model, over = {}, opts = {}) => kie.buildInput(req({ init: init(), ...over }), cfg({ model }), { imageUrl: URL1, ...opts });
    expect(pic('flux-2/pro-text-to-image', { quality: 'high' })).toEqual({
      model: 'flux-2/pro-image-to-image', input: { prompt: 'a gourd', aspect_ratio: 'auto', resolution: '2K', nsfw_checker: true, input_urls: [URL1] },
    });
    expect(pic('seedream/5-lite-text-to-image', { shape: 'wide' })).toEqual({
      model: 'seedream/5-lite-image-to-image', input: { prompt: 'a gourd', output_format: 'png', aspect_ratio: '16:9', quality: 'basic', nsfw_checker: true, image_urls: [URL1] },
    });
    expect(pic('qwen/text-to-image', { quality: 'draft' }, { permissive: true })).toEqual({
      model: 'qwen/image-to-image',
      input: { prompt: 'a gourd', output_format: 'png', acceleration: 'none', num_inference_steps: 20, nsfw_checker: false, enable_safety_checker: false, image_url: URL1, strength: 0.3 },
    });
    expect(pic('grok-imagine/text-to-image', { shape: 'portrait' })).toEqual({
      model: 'grok-imagine/image-to-image', input: { prompt: 'a gourd', nsfw_checker: true, image_urls: [URL1] },
    });
    expect(pic('nano-banana-2')).toEqual({
      model: 'nano-banana-2', input: { prompt: 'a gourd', output_format: 'png', image_input: [URL1], aspect_ratio: 'auto', resolution: '1K' },
    });
    // No picture version: the chosen model for pictures, or none.
    expect(() => pic('z-image')).toThrow('This kie.ai model can’t start from a picture');
    expect(kie.buildInput(req({ init: init() }), cfg({ model: 'z-image', pictureModel: 'grok-imagine/text-to-image' }), { imageUrl: URL1 }).model).toBe('grok-imagine/image-to-image');
    expect(kie.buildInput(req({ init: init() }), cfg({ model: 'custom', customModel: 'v/m', pictureModel: 'qwen/text-to-image' }), { imageUrl: URL1 }).input.strength).toBe(0.3);
    // What pictures can do, per setup.
    expect(kie.pictures(cfg({ model: 'qwen/text-to-image' }))).toEqual({ strength: true });
    expect(kie.pictures(cfg({ model: 'flux-2/pro-text-to-image' }))).toEqual({ strength: false });
    expect(kie.pictures(cfg({ model: 'z-image' }))).toBe(null);
    expect(kie.pictures(cfg({ model: 'z-image', pictureModel: 'nano-banana-2' }))).toEqual({ strength: false });
    // Settings: the model for pictures must have a picture version.
    expect(kie.validateConfig({ pictureModel: 'z-image' }, cfg())).toEqual({ error: 'Pick a model for pictures' });
    expect(kie.validateConfig({ pictureModel: 'qwen/text-to-image' }, cfg()).pictureModel).toBe('qwen/text-to-image');
    expect(kie.validateConfig({ pictureModel: null }, cfg({ pictureModel: 'nano-banana-2' })).pictureModel).toBe('');
    expect(kie.publicConfig(cfg({ model: 'z-image', pictureModel: 'qwen/text-to-image' }))).toMatchObject({ pictureModel: 'qwen/text-to-image', pictures: { strength: true } });
    expect(kie.catalogue().find((m) => m.id === 'qwen/text-to-image').picture).toEqual({ model: 'qwen/image-to-image', strength: true });
    expect(kie.catalogue().find((m) => m.id === 'z-image').picture).toBe(null);
    // Prices: a picture job is priced by the picture model.
    expect(kie.priceFor(cfg({ model: 'grok-imagine/text-to-image' }), 'standard', { picture: true })).toEqual({ credits: 4, estimate: true });
    expect(kie.priceFor(cfg({ model: 'z-image' }), 'standard', { picture: true })).toBe(null);
  });

  test('the picture is uploaded to kie.ai first (base64, or a stream when big); the task gets its URL', async () => {
    const before = seen.uploads.length;
    const out = await kie.generate(req({ init: init({ denoise: 0.65 }) }), cfg({ model: 'qwen/text-to-image' }));
    expect(out).toMatchObject({ model: 'qwen/image-to-image', cost: 0.8 });
    const up = seen.uploads[before];
    expect(up).toMatchObject({ kind: 'base64', uploadPath: 'disgourd' });
    expect(up.base64Data).toBe(`data:image/png;base64,${PNG.toString('base64')}`);
    expect(up.fileName).toMatch(/^disgourd-[0-9a-f]{16}\.png$/);
    expect(seen.auth.at(-1)).toBe(`Bearer ${KEY}`);
    expect(seen.bodies.at(-1).input).toMatchObject({ image_url: `https://tempfile.example/kieai/disgourd/${up.fileName}`, strength: 0.65 });
    // Over 10 MB: a file stream (Nano Banana takes up to 30 MB).
    const big = Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)]);
    await kie.generate(req({ init: init({ buffer: big }) }), cfg({ model: 'nano-banana-2' }));
    expect(seen.uploads.at(-1)).toMatchObject({ kind: 'stream' });
    expect(seen.uploads.at(-1).type).toMatch(/^multipart\/form-data/);
    expect(seen.bodies.at(-1).input.image_input).toEqual(['https://tempfile.example/kieai/disgourd/big.png']);
    // Too big for the model: refused before uploading.
    const count = seen.uploads.length;
    await expect(kie.generate(req({ init: init({ buffer: big }) }), cfg({ model: 'grok-imagine/text-to-image' }))).rejects.toMatchObject({ message: 'That picture is too big for Grok Imagine (10 MB at most)' });
    expect(seen.uploads.length).toBe(count);
    // Upload errors in plain words.
    seen.failUpload = true;
    await expect(kie.generate(req({ init: init() }), cfg({ model: 'qwen/text-to-image' }))).rejects.toMatchObject({ code: 'ENGINE', message: 'kie.ai: upload failed' });
    seen.failUpload = false;
    await expect(kie.generate(req({ init: init() }), cfg({ model: 'qwen/text-to-image', apiKey: 'wrong' }))).rejects.toMatchObject({ message: 'kie.ai rejected the API key' });
    await expect(kie.generate(req({ init: init() }), cfg({ model: 'z-image' }))).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });
});

describe('generating', () => {
  test('create → poll → download, with the real cost', async () => {
    const out = await kie.generate(req(), cfg());
    expect(out).toMatchObject({ model: 'z-image', cost: 0.8 });
    expect(out.images[0].buffer.equals(PNG)).toBe(true);
    expect(out.images[0].contentType).toBe('image/png');
    expect(seen.auth.at(-1)).toBe(`Bearer ${KEY}`);
  });

  test('errors in plain words', async () => {
    await expect(kie.generate(req(), cfg({ apiKey: 'wrong' }))).rejects.toMatchObject({ code: 'UNAVAILABLE', message: 'kie.ai rejected the API key' });
    await expect(kie.generate(req({ prompt: 'x [402]' }), cfg())).rejects.toMatchObject({ message: 'The kie.ai account is out of credits' });
    await expect(kie.generate(req({ prompt: 'x [429]' }), cfg())).rejects.toMatchObject({ message: 'kie.ai is limiting requests; try again in a moment' });
    await expect(kie.generate(req({ prompt: 'x [refuse]' }), cfg())).rejects.toMatchObject({ code: 'REFUSED' });
    await expect(kie.generate(req({ prompt: 'x [broken]' }), cfg())).rejects.toMatchObject({ code: 'ENGINE', message: 'kie.ai’s Z-Image hit a problem on kie.ai’s side ("internal error"); try again in a moment' });
    await expect(kie.generate(req({ prompt: 'x [odd]' }), cfg())).rejects.toMatchObject({ code: 'ENGINE', message: 'kie.ai couldn’t make it with Z-Image: prompt too long. No credits were used' });
    await expect(kie.generate(req(), cfg({ apiKey: '' }))).rejects.toMatchObject({ message: 'No kie.ai API key is set' });
  });

  test('P13-02: kie.ai’s own timeout is explained, retried once when nothing was charged, then reported', async () => {
    const before = seen.bodies.length;
    await expect(kie.generate(req({ prompt: 'x [timeout]' }), cfg({ model: 'nano-banana-2' }))).rejects.toMatchObject({
      code: 'ENGINE',
      message: 'kie.ai’s Nano Banana 2 ran out of time on kie.ai’s own servers ("generate task timeout"). The request was fine; try again, or a lower quality. No credits were used (tried twice)',
    });
    expect(seen.bodies.length - before).toBe(2); // one retry, no more
    // A timeout that clears on the retry just works.
    seen.timedOutOnce = false;
    const out = await kie.generate(req({ prompt: 'y [timeout-once]' }), cfg());
    expect(out.images).toHaveLength(1);
    // The refusal and a charged failure aren't retried.
    const n = seen.bodies.length;
    await expect(kie.generate(req({ prompt: 'z [refuse]' }), cfg())).rejects.toMatchObject({ code: 'REFUSED' });
    expect(seen.bodies.length - n).toBe(1);
  });

  test('stopping a job stops the polling', async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 80);
    await expect(kie.generate(req({ prompt: 'long [slow]' }), cfg(), { signal: ac.signal })).rejects.toMatchObject({ code: 'ABORTED' });
    // A status check already on its way may still land; after that, none.
    await new Promise((r) => setTimeout(r, 60));
    const polls = seen.polls;
    await new Promise((r) => setTimeout(r, 150));
    expect(seen.polls).toBe(polls);
  });
});

describe('settings, key and price', () => {
  test('validation, and the key never leaves the server', () => {
    expect(kie.validateConfig({ model: 'nope' }).error).toMatch(/Pick a kie.ai model/);
    expect(kie.validateConfig({ model: 'custom', customModel: 'bad id!' }).error).toMatch(/custom model/);
    expect(kie.validateConfig({ enabled: true, model: 'z-image' }).error).toMatch(/Add an API key/);
    expect(kie.validateConfig({ monthlyCredits: -1 }).error).toMatch(/0 or more/);
    const saved = kie.validateConfig({ enabled: true, apiKey: ` ${KEY} `, model: 'z-image', monthlyCredits: 500 });
    expect(saved).toMatchObject({ enabled: true, apiKey: KEY, model: 'z-image', monthlyCredits: 500 });
    expect(kie.validateConfig({ apiKey: '' }, saved).apiKey).toBe(KEY); // blank keeps the saved key
    expect(kie.validateConfig({ apiKey: null }, { ...saved, enabled: false }).apiKey).toBe(''); // null clears it
    expect(kie.validateConfig({ apiKey: null }, saved).error).toMatch(/Add an API key/); // not while it's on
    const shown = kie.publicConfig(saved);
    expect(shown).toMatchObject({ keySaved: true, keyHint: '••••1234', envKey: false });
    expect(JSON.stringify(shown)).not.toContain(KEY);
  });

  test('the KIEAI_API_KEY environment variable overrides the saved key', () => {
    process.env.KIEAI_API_KEY = 'from-env';
    try {
      expect(kie.keyOf({ apiKey: KEY })).toBe('from-env');
      expect(kie.publicConfig({}).envKey).toBe(true);
      expect(kie.validateConfig({ enabled: true, model: 'z-image' }).error).toBeUndefined();
    } finally {
      delete process.env.KIEAI_API_KEY;
    }
  });

  test('the price is the last real cost, else the estimate, else unknown', () => {
    expect(kie.priceFor(cfg({ model: 'z-image' }), 'standard')).toEqual({ credits: 0.8, estimate: true });
    expect(kie.priceFor(cfg({ model: 'flux-2/pro-text-to-image' }), 'standard')).toBeNull();
    const id = db.createImagineJob({ userId: null, spaceId: null, channelId: null, engine: 'kie', prompt: 'p', shape: 'square', quality: 'standard', cost: 0 });
    db.updateImagineJob(id, { status: 'done', model: 'flux-2/pro-text-to-image', cost: 5.5 });
    expect(kie.priceFor(cfg({ model: 'flux-2/pro-text-to-image' }), 'standard')).toEqual({ credits: 5.5, estimate: false });
    expect(kie.priceFor(cfg({ model: 'flux-2/pro-text-to-image' }), 'high')).toBeNull(); // learned per quality
  });
});

describe('admin routes and the chat path', () => {
  const users = {};
  const call = async (who, method, p, body) => {
    const res = await fetch(`http://localhost:${port}${p}`, {
      method, headers: { 'content-type': 'application/json', Authorization: `Bearer ${users[who].token}` }, body: body && JSON.stringify(body),
    });
    return { status: res.status, text: await res.text() };
  };
  const json = (r) => JSON.parse(r.text);
  beforeAll(async () => {
    for (const name of ['admin', 'pat']) {
      const res = await fetch(`http://localhost:${port}/register`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: name, password: 'gourd-test-pass-1', email: `${name}@example.com` }),
      });
      users[name] = { token: (await res.json()).token, id: db.getUserByUsername(name).id };
    }
  });

  test('test key: site admins only; a given key or the saved one; the balance', async () => {
    expect((await call('pat', 'POST', '/admin/imagine/kie/test', { apiKey: KEY })).status).toBe(403);
    expect(json(await call('admin', 'POST', '/admin/imagine/kie/test', { apiKey: 'wrong' }))).toEqual({ error: 'kie.ai rejected the API key' });
    expect(json(await call('admin', 'POST', '/admin/imagine/kie/test', { apiKey: KEY }))).toEqual({ credits: 123.5 });
    await call('admin', 'PUT', '/admin/imagine', { engines: { kie: { apiKey: KEY, model: 'z-image' } } });
    expect(json(await call('admin', 'POST', '/admin/imagine/kie/test', {}))).toEqual({ credits: 123.5 });
  });

  test('the admin view lists the models with prices and never includes the key', async () => {
    const view = await call('admin', 'GET', '/admin/imagine');
    expect(view.text).not.toContain(KEY);
    const k = json(view).engines.find((e) => e.id === 'kie');
    expect(k.config).toMatchObject({ keySaved: true, keyHint: '••••1234', model: 'z-image' });
    expect(k.models.find((m) => m.id === 'z-image')).toMatchObject({ name: 'Z-Image', filterable: true, price: { credits: 0.8, estimate: true } });
    expect(k.models.find((m) => m.id === 'nano-banana-2').filterable).toBe(false);
    expect(k.models.at(-1).id).toBe('custom');
  });

  test("the admin view says what kie.ai has cost this month (P7-05); failed and last month's jobs don't count", async () => {
    const before = json(await call('admin', 'GET', '/admin/imagine')).engines.find((e) => e.id === 'kie').spentThisMonth;
    const job = (cost, at, status = 'done') => {
      const id = db.createImagineJob({ userId: null, spaceId: null, channelId: null, engine: 'kie', prompt: 'p', shape: 'square', quality: 'standard', cost });
      db.raw.prepare('UPDATE imagine_jobs SET status = ?, created_at = ? WHERE id = ?').run(status, at, id);
    };
    const now = Date.now();
    const lastMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime() - 1000;
    job(0.8, now);
    job(1.25, now);
    job(5, now, 'failed');
    job(9, lastMonth);
    const after = json(await call('admin', 'GET', '/admin/imagine'));
    expect(after.engines.find((e) => e.id === 'kie').spentThisMonth).toBeCloseTo(before + 2.05, 5);
    // ComfyUI is free, so it has no figure.
    expect(after.engines.find((e) => e.id === 'comfyui')?.spentThisMonth).toBeUndefined();
  });

  test('a chat request on kie.ai: the image, its real cost, the price in GET /spaces, and the monthly cap', async () => {
    // A cap with room for exactly one more 0.8-credit image this month.
    const spent = db.imagineCreditsSince('kie', new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime());
    await call('admin', 'PUT', '/admin/imagine', { engines: { kie: { enabled: true, monthlyCredits: spent + 1 } }, defaultEngine: 'kie' });
    db.createSpaceWithDefaults('Kie Club', users.admin.id);
    await call('admin', 'PATCH', '/spaces/Kie%20Club/imagine', { enabled: true });
    const space = json(await call('admin', 'GET', '/spaces')).find((s) => s.name === 'Kie Club');
    expect(space.imagine.engines.find((e) => e.id === 'kie').price.standard).toEqual({ credits: 0.8, estimate: true });
    const frames = [];
    const ws = new WebSocket(`ws://localhost:${port}/gateway?token=${users.admin.token}`);
    ws.on('message', (raw) => frames.push(JSON.parse(raw.toString())));
    await new Promise((r) => ws.on('open', r));
    const ask = async (prompt) => {
      const from = frames.length;
      ws.send(JSON.stringify({ op: 'imagine', space: 'Kie Club', channel: 'general', prompt }));
      const end = Date.now() + 5000;
      for (;;) {
        const f = frames.slice(from).find((x) => x.type === 'imagine_queued' || (x.type === 'error' && x.op === 'imagine'));
        if (f || Date.now() > end) return f;
        await new Promise((r) => setTimeout(r, 15));
      }
    };
    const queued = await ask('a gourd on the moon');
    expect(queued.type).toBe('imagine_queued');
    const end = Date.now() + 5000;
    while (!db.getImagineJob(queued.jobId) || db.getImagineJob(queued.jobId).status !== 'done') {
      if (Date.now() > end) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(db.getImagineJob(queued.jobId)).toMatchObject({ engine: 'kie', model: 'z-image', status: 'done', cost: 0.8 });
    // Now 0.8 more is spent, and another 0.8 would go over the cap.
    expect(await ask('another one')).toMatchObject({ type: 'error', code: 'BUDGET' });
    ws.close();
  });

  test('P9-05a: pictures on kie.ai: start from a picture, Variations on the engine that made the image, Retry; ComfyUI when chosen', async () => {
    const S = 'Kie Pictures';
    const put = (kieCfg) => call('admin', 'PUT', '/admin/imagine', { engines: { kie: { enabled: true, monthlyCredits: null, ...kieCfg } }, defaultEngine: 'kie' });
    expect((await put({ model: 'qwen/text-to-image' })).status).toBe(200);
    db.createSpaceWithDefaults(S, users.admin.id);
    await call('admin', 'PATCH', `/spaces/${encodeURIComponent(S)}/imagine`, { enabled: true, dailyLimit: 100 });
    const info = async () => json(await call('admin', 'GET', '/spaces')).find((s) => s.name === S).imagine;
    expect(await info()).toMatchObject({ canVary: true, canUpscale: false, pictures: { kie: { strength: true } } });
    // A picture someone uploaded.
    fs.mkdirSync(path.join(UPLOADS, 'abc123'), { recursive: true });
    fs.writeFileSync(path.join(UPLOADS, 'abc123', 'pic.png'), PNG);
    const frames = [];
    const ws = new WebSocket(`ws://localhost:${port}/gateway?token=${users.admin.token}`);
    ws.on('message', (raw) => frames.push(JSON.parse(raw.toString())));
    await new Promise((r) => ws.on('open', r));
    const ask = async (fields) => {
      const from = frames.length;
      ws.send(JSON.stringify({ op: 'imagine', space: S, channel: 'general', ...fields }));
      const end = Date.now() + 5000;
      for (;;) {
        const f = frames.slice(from).find((x) => x.type === 'imagine_queued' || (x.type === 'error' && x.op === 'imagine'));
        if (f) return f;
        if (Date.now() > end) throw new Error('no answer');
        await new Promise((r) => setTimeout(r, 15));
      }
    };
    const settle = async (jobId) => {
      const end = Date.now() + 5000;
      while (!['done', 'failed'].includes(db.getImagineJob(jobId).status) && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
      return db.getImagineJob(jobId);
    };
    const said = (id) => db.raw.prepare('SELECT content FROM messages WHERE id = ?').get(id).content;
    try {
      // Start from a picture on Qwen: uploaded, then the task with the URL and the strength.
      const ups = seen.uploads.length;
      const p = await ask({ prompt: 'a gourd at night', init: { url: '/uploads/abc123/pic.png', strength: 'strong' } });
      const pJob = await settle(p.jobId);
      expect(pJob).toMatchObject({ engine: 'kie', kind: 'img2img', model: 'qwen/image-to-image', status: 'done', strength: 0.65 });
      expect(seen.uploads.length).toBe(ups + 1);
      expect(seen.bodies.at(-1)).toMatchObject({ model: 'qwen/image-to-image', input: { image_url: expect.stringMatching(/^https:\/\/tempfile\.example\//), strength: 0.65 } });
      // The message says which engine made it, in history and in the update frame.
      expect(db.getMessages(S, 'general', 50).find((m) => Number(m.id) === p.messageId).imagineEngine).toBe('kie');
      expect(frames.filter((f) => f.type === 'message_update' && Number(f.id) === p.messageId).at(-1).imagineEngine).toBe('kie');
      expect(db.getMessages(S, 'general', 50).some((m) => !m.bot && 'imagineEngine' in m)).toBe(false);
      // A Subtle variation on Qwen keeps its strength and its name.
      const v1 = await ask({ from: p.messageId, vary: 'subtle' });
      expect(await settle(v1.jobId)).toMatchObject({ engine: 'kie', kind: 'vary', model: 'qwen/image-to-image', strength: 0.3 });
      expect(said(v1.messageId)).toBe('🎲 **admin** varied (subtle): a gourd at night');
      // Grok has no strength: one kind of Variation (`once`; Subtle reads the same), named without one.
      await put({ model: 'grok-imagine/text-to-image' });
      expect((await info()).pictures).toEqual({ kie: { strength: false } });
      const v2 = await ask({ from: p.messageId, vary: 'once' });
      expect(await settle(v2.jobId)).toMatchObject({ engine: 'kie', kind: 'vary', model: 'grok-imagine/image-to-image', status: 'done' });
      expect(said(v2.messageId)).toBe('🎲 **admin** varied: a gourd at night');
      expect(seen.bodies.at(-1).input).toEqual({ prompt: 'a gourd at night', nsfw_checker: true, image_urls: [expect.stringMatching(/^https:/)] });
      const v3 = await ask({ from: p.messageId, vary: 'strong' });
      await settle(v3.jobId);
      expect(said(v3.messageId)).toBe('🎲 **admin** varied: a gourd at night');
      // Upscale stays ComfyUI's.
      expect(await ask({ from: p.messageId, upscale: true })).toMatchObject({ type: 'error', code: 'NO_ENGINE' });
      // A failed picture job is retried on kie.ai.
      const bad = await ask({ prompt: 'a gourd [broken]', init: { url: '/uploads/abc123/pic.png', strength: 'subtle' } });
      expect(await settle(bad.jobId)).toMatchObject({ status: 'failed', engine: 'kie' });
      const again = await ask({ from: bad.messageId });
      expect(db.getImagineJob(again.jobId)).toMatchObject({ engine: 'kie', kind: 'img2img' });
      await settle(again.jobId);
      // Z-Image has no picture version: no pictures until one is chosen.
      await put({ model: 'z-image', pictureModel: '' });
      expect(await info()).toMatchObject({ canVary: false, pictures: {} });
      expect(await ask({ prompt: 'a gourd', init: { url: '/uploads/abc123/pic.png', strength: 'subtle' } })).toMatchObject({
        type: 'error', code: 'NO_ENGINE', error: 'Starting from a picture needs ComfyUI or a kie.ai model that takes pictures (Settings → Image generation)',
      });
      expect(json(await put({ pictureModel: 'z-image' }))).toEqual({ error: 'Pick a model for pictures' });
      await put({ pictureModel: 'qwen/text-to-image' });
      expect((await info()).pictures).toEqual({ kie: { strength: true } });
      // With ComfyUI on too: the panel's engine decides, and a ComfyUI image is varied on ComfyUI.
      const settings = JSON.parse(db.getSetting('imagine'));
      settings.engines.comfyui = { enabled: true, url: 'http://127.0.0.1:9', model: 'x.safetensors', family: 'sdxl' };
      db.setSetting('imagine', JSON.stringify(settings));
      expect((await info()).pictures).toEqual({ comfyui: { strength: true }, kie: { strength: true } });
      const onComfy = await ask({ prompt: 'a gourd', engine: 'comfyui', init: { url: '/uploads/abc123/pic.png', strength: 'subtle' } });
      expect(db.getImagineJob(onComfy.jobId).engine).toBe('comfyui');
      const onKie = await ask({ prompt: 'a gourd', engine: 'kie', init: { url: '/uploads/abc123/pic.png', strength: 'subtle' } });
      expect(db.getImagineJob(onKie.jobId)).toMatchObject({ engine: 'kie', model: null });
      await settle(onComfy.jobId);
      await settle(onKie.jobId);
      expect(db.getImagineJob(onKie.jobId)).toMatchObject({ engine: 'kie', model: 'qwen/image-to-image' });
      // Pretend the ComfyUI job finished: its Variation runs on ComfyUI; the kie.ai image's on kie.ai.
      db.updateImagineJob(onComfy.jobId, { status: 'done' });
      db.updateBotMessage(onComfy.messageId, '🎨 **admin** imagined: a gourd', ['/uploads/abc123/pic.png']);
      const cv = await ask({ from: onComfy.messageId, vary: 'subtle' });
      expect(db.getImagineJob(cv.jobId).engine).toBe('comfyui');
      const kv = await ask({ from: p.messageId, vary: 'subtle' });
      expect(db.getImagineJob(kv.jobId).engine).toBe('kie');
      await settle(cv.jobId);
      await settle(kv.jobId);
      // kie.ai off: a kie.ai image's Variation falls back to ComfyUI.
      const off = JSON.parse(db.getSetting('imagine'));
      off.engines.kie.enabled = false;
      db.setSetting('imagine', JSON.stringify(off));
      const fb = await ask({ from: p.messageId, vary: 'subtle' });
      expect(db.getImagineJob(fb.jobId).engine).toBe('comfyui');
      await settle(fb.jobId);
    } finally {
      ws.close();
      const s2 = JSON.parse(db.getSetting('imagine'));
      delete s2.engines.comfyui;
      db.setSetting('imagine', JSON.stringify(s2));
    }
  });
});
