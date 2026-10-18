// P2-20c: the kie.ai engine against a mock kie.ai API — request bodies per
// model, polling, downloads, errors, the key handling, prices and the monthly
// credit cap.
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

const seen = { bodies: [], auth: [], polls: 0 };
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
    await expect(kie.generate(req({ prompt: 'x [broken]' }), cfg())).rejects.toMatchObject({ code: 'ENGINE', message: 'kie.ai: internal error' });
    await expect(kie.generate(req(), cfg({ apiKey: '' }))).rejects.toMatchObject({ message: 'No kie.ai API key is set' });
  });

  test('stopping a job stops the polling', async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 80);
    await expect(kie.generate(req({ prompt: 'long [slow]' }), cfg(), { signal: ac.signal })).rejects.toMatchObject({ code: 'ABORTED' });
    const polls = seen.polls;
    await new Promise((r) => setTimeout(r, 100));
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
        body: JSON.stringify({ username: name, password: 'password123', email: `${name}@example.com` }),
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
});
