// /imagine (P2-20): settings, who may use it, and the `imagine` gateway op.
// Engines live in ./engines (fake here; ComfyUI and kie.ai in P2-20b/c) and
// share one request shape: { prompt, shape, quality }. The runner queues the
// jobs and turns the bot's placeholder into the image.
const db = require('../db');
const { canViewChannel, canPostChannel, canDoAction } = require('../permissions');
const { deliverToChannelViewers } = require('../gateway/delivery');
const { refusedReason } = require('./promptCheck');
const runner = require('./runner');
const fs = require('fs');
const path = require('path');
const { imageSize } = require('./imageSize');
const { UPLOADS_DIR } = require('../routes/uploads');

const ENGINES = new Map([
  ['comfyui', require('./engines/comfyui')],
  ['kie', require('./engines/kie')],
  ['fake', require('./engines/fake')],
]);
const SHAPES = ['square', 'portrait', 'landscape', 'wide'];
const QUALITIES = ['draft', 'standard', 'high'];
const MAX_PROMPT = 1000;
// The Upscale button (P3-29): 2×, with the longest side capped.
const UPSCALE_FACTOR = 2;
const UPSCALE_MAX_SIDE = 4096;
const MIN_UPSCALE = 1.25;
// Variations (P3-36a): an img2img loopback from the image, repainting this
// much (denoise) on each loop; the loop count is a ComfyUI setting.
// The defaults; the host can change both in Settings → Advanced.
const VARY = { subtle: 0.3, strong: 0.65 };
function varyStrengths(settings = getSettings()) {
  const c = settings.engines.comfyui || {};
  return { subtle: c.varySubtle ?? VARY.subtle, strong: c.varyStrong ?? VARY.strong };
}
const DAY_MS = 24 * 60 * 60 * 1000;

const DEFAULTS = { defaultEngine: null, permissive: false, dailyLimit: 20, dailyCeiling: 100, engines: {} };

// ---- Instance settings (site admins) ----
function getSettings() {
  let stored = {};
  try {
    stored = JSON.parse(db.getSetting('imagine') || '{}') || {};
  } catch {
    stored = {};
  }
  return { ...DEFAULTS, ...stored, engines: { ...(stored.engines || {}) } };
}
const engineConfig = (settings, id) => settings.engines[id] || {};
// Engines that exist here and that the admin switched on.
function enabledEngines(settings = getSettings()) {
  return [...ENGINES.values()].filter((e) => e.available() && engineConfig(settings, e.id).enabled);
}
// What admins see: every available engine with its (masked) config.
function adminView(settings = getSettings()) {
  return {
    defaultEngine: settings.defaultEngine,
    permissive: !!settings.permissive,
    dailyLimit: settings.dailyLimit,
    dailyCeiling: settings.dailyCeiling,
    // Servers whose own limit takes priority over the default (P3-21).
    serverLimits: db.getSpaceImagineLimits(),
    engines: [...ENGINES.values()].filter((e) => e.available()).map((e) => ({
      id: e.id,
      name: e.name,
      config: e.publicConfig(engineConfig(settings, e.id)),
      ...(e.catalogue ? { models: e.catalogue(engineConfig(settings, e.id)) } : {}),
    })),
  };
}
const intIn = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
// Apply a PUT body. Returns the new admin view, or { error }.
function updateSettings(body) {
  const s = getSettings();
  if (body.permissive !== undefined) s.permissive = !!body.permissive;
  if (body.dailyCeiling !== undefined) {
    if (!intIn(body.dailyCeiling, 1, 10000)) return { error: 'The daily ceiling is 1–10000' };
    s.dailyCeiling = body.dailyCeiling;
  }
  if (body.dailyLimit !== undefined) {
    if (!intIn(body.dailyLimit, 1, s.dailyCeiling)) return { error: `The daily limit is 1–${s.dailyCeiling}` };
    s.dailyLimit = body.dailyLimit;
  }
  s.dailyLimit = Math.min(s.dailyLimit, s.dailyCeiling);
  if (body.engines !== undefined) {
    if (!body.engines || typeof body.engines !== 'object') return { error: 'engines must be an object' };
    for (const [id, input] of Object.entries(body.engines)) {
      const engine = ENGINES.get(id);
      if (!engine || !engine.available()) return { error: `Unknown engine: ${id}` };
      const cfg = engine.validateConfig(input, engineConfig(s, id));
      if (cfg && cfg.error) return { error: cfg.error };
      s.engines[id] = cfg;
    }
  }
  if (body.defaultEngine !== undefined) {
    if (body.defaultEngine !== null && !ENGINES.has(body.defaultEngine)) return { error: `Unknown engine: ${body.defaultEngine}` };
    s.defaultEngine = body.defaultEngine;
  }
  db.setSetting('imagine', JSON.stringify(s));
  return adminView(s);
}

// ---- Per server and per user ----
// The server's daily limit per user (its own, within the instance ceiling).
function dailyLimitFor(spaceId, settings = getSettings()) {
  return limitInfo(spaceId, settings).limit;
}
// The limit and where it comes from (P3-21): 'server' (the server's own
// number, which takes priority), 'instance' (the instance default), or
// 'ceiling' (either one, capped by the instance's maximum).
function limitInfo(spaceId, settings = getSettings()) {
  const own = db.getSpaceImagine(spaceId)?.dailyLimit;
  const wanted = own ?? settings.dailyLimit;
  if (wanted > settings.dailyCeiling) return { limit: settings.dailyCeiling, source: 'ceiling' };
  return { limit: wanted, source: own != null ? 'server' : 'instance' };
}
// The refusal when someone's used them all, saying where the number is set.
function limitMessage(spaceName, { limit, source }) {
  const where = {
    server: `${spaceName} sets its own limit of ${limit} a day (server menu → Image generation).`,
    instance: `This instance allows ${limit} a day (Settings → Image generation).`,
    ceiling: `That's this instance's maximum of ${limit} a day.`,
  }[source];
  return `You’ve used all ${limit} images for today. ${where}`;
}
const usedToday = (userId) => db.countImagineJobsSince(userId, Date.now() - DAY_MS);
// The start of this calendar month (the kie.ai credit cap counts from here).
function monthStart(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
}
// Whether one more image would go over an engine's monthly credit cap.
function overBudget(engine, config, cost) {
  const cap = engine.monthlyCap ? engine.monthlyCap(config) : 0;
  return cap > 0 && db.imagineCreditsSince(engine.id, monthStart()) + cost > cap;
}
// An engine's price per image at each quality (engines that charge), or null.
function enginePrices(engine, config) {
  if (!engine.priceFor) return null;
  return Object.fromEntries(QUALITIES.map((q) => [q, engine.priceFor(config, q)]));
}

// GET /spaces gains `imagine` per server: whether it's on here, whether I may
// use it, my limit and use, and the engines to choose from.
function decorateSpaces(list, userId) {
  const settings = getSettings();
  const engines = enabledEngines(settings).map((e) => ({ id: e.id, name: e.name, price: enginePrices(e, engineConfig(settings, e.id)) }));
  const used = usedToday(userId);
  return list.map((s) => {
    const space = db.getSpaceByName(s.name);
    const own = space ? db.getSpaceImagine(space.id) : null;
    return {
      ...s,
      imagine: {
        enabled: !!(own && own.enabled && engines.length),
        serverEnabled: !!(own && own.enabled),
        ownLimit: own ? own.dailyLimit : null, // the server's own, or null for the instance default
        canUse: !!(space && canDoAction(space.id, userId, 'generate_images')),
        dailyLimit: space ? dailyLimitFor(space.id, settings) : 0,
        limitSource: space ? limitInfo(space.id, settings).source : 'instance', // P3-21
        instanceLimit: Math.min(settings.dailyLimit, settings.dailyCeiling), // what a blank server limit falls back to
        canUpscale: engines.some((e) => e.id === 'comfyui'), // P3-29: the Upscale button runs on ComfyUI
        canVary: engines.some((e) => e.id === 'comfyui'), // P3-36a: img2img Variations too
        usedToday: used,
        engines,
      },
    };
  });
}

// ---- The `imagine` gateway op ----
// A refusal: { type: 'error', op: 'imagine', code, error }.
function refuse(ws, code, error) {
  if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'error', op: 'imagine', code, error }));
}

// An image of ours from its /uploads URL: { buffer, contentType, ext, width,
// height }, or null (P3-36a: shared by upscales and variations).
function readUpload(url) {
  const m = typeof url === 'string' && url.match(/^\/uploads\/([a-f0-9]+)\/([^/\\]+)$/i);
  if (!m) return null;
  let name;
  try {
    name = decodeURIComponent(m[2]);
  } catch {
    return null;
  }
  // A plain file name in its own upload folder (people's uploads keep their
  // names, spaces and all — P3-36b), and a picture we can read.
  const ext = (name.match(/\.(png|jpe?g|webp)$/i) || [])[1];
  if (!ext || path.basename(name) !== name || name.startsWith('.')) return null;
  const file = path.join(UPLOADS_DIR, m[1], name);
  if (!fs.existsSync(file)) return null;
  const buffer = fs.readFileSync(file);
  const size = imageSize(buffer);
  if (!size) return null;
  const e = ext.toLowerCase().replace('jpeg', 'jpg');
  return { buffer, ext: e, contentType: { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }[e], width: size.width, height: size.height };
}

// Starting /imagine from a picture (P3-36b): an image someone uploaded (its
// /uploads URL) or the one in a message they're replying to here. Strength
// subtle / medium / strong (medium is halfway between the host's two).
const STRENGTHS = ['subtle', 'medium', 'strong'];
// The shape nearest the picture's proportions.
function shapeOf({ width, height }) {
  const r = width / height;
  return r >= 1.6 ? 'wide' : r >= 1.2 ? 'landscape' : r <= 0.83 ? 'portrait' : 'square';
}
function initSource(ws, msg, retrySource) {
  const strengths = varyStrengths();
  if (retrySource) {
    const image = readUpload(retrySource.source_url);
    if (!image) return refuse(ws, 'NOT_FOUND', 'That picture is gone'), null;
    return { url: retrySource.source_url, strength: retrySource.strength, request: { ...image, denoise: retrySource.strength }, shape: shapeOf(image) };
  }
  const init = msg.init && typeof msg.init === 'object' ? msg.init : {};
  if (!STRENGTHS.includes(init.strength)) return refuse(ws, 'BAD_OPTION', 'Pick Subtle, Medium or Strong'), null;
  let url = null;
  if (init.messageId != null) {
    // Only a message in this very channel (like replies), and only its picture.
    const ref = db.channelRef(msg.space, msg.channel);
    const row = ref && db.raw.prepare('SELECT id FROM messages WHERE id = ? AND channel_id = ?').get(Number(init.messageId), ref.channelId);
    url = row ? db.getMessageAttachments(row.id).find((u) => readUpload(u)) || null : null;
  } else if (typeof init.url === 'string') {
    url = init.url;
  }
  const image = url && readUpload(url);
  if (!image) return refuse(ws, 'NOT_FOUND', 'That picture can’t be used (a PNG, JPEG or WebP image here)'), null;
  const strength = init.strength === 'medium' ? Math.round(((strengths.subtle + strengths.strong) / 2) * 100) / 100 : strengths[init.strength];
  return { url, strength, request: { ...image, denoise: strength }, shape: shapeOf(image) };
}

// The image a variation starts from (P3-36a): a finished image of any kind, or
// a Retry of a failed variation (same image, same strength). Null after refusing.
function varySource(ws, msg, source) {
  const retry = source.kind === 'vary' && source.status === 'failed';
  if (!retry && source.status !== 'done') {
    refuse(ws, 'NOT_FOUND', 'That image can’t be varied');
    return null;
  }
  const url = retry ? source.source_url : db.getMessageAttachments(source.message_id)[0];
  const image = readUpload(url);
  if (!image) {
    refuse(ws, 'NOT_FOUND', 'That image is gone');
    return null;
  }
  const strengths = varyStrengths();
  const strength = retry ? source.strength : strengths[msg.vary];
  // A retry's name: whichever setting its strength is nearer.
  const name = retry ? (strength >= (strengths.subtle + strengths.strong) / 2 ? 'strong' : 'subtle') : msg.vary;
  return { url, strength, name, request: { ...image, denoise: strength } };
}

// The image an upscale starts from (P3-29), sized and capped, or null after
// refusing. The button needs a finished, not-yet-upscaled image; a Retry of a
// failed upscale reuses the image it started from.
function upscaleSource(ws, msg, source) {
  const retry = source.kind === 'upscale' && source.status === 'failed';
  if (!retry && (source.status !== 'done' || source.kind === 'upscale')) {
    refuse(ws, 'NOT_FOUND', source.kind === 'upscale' ? 'That image is already upscaled' : 'That image can’t be upscaled');
    return null;
  }
  const url = retry ? source.source_url : db.getMessageAttachments(source.message_id)[0];
  const m = typeof url === 'string' && url.match(/^\/uploads\/([a-f0-9]+)\/([\w.-]+\.(png|jpe?g|webp))$/i);
  const file = m && path.join(UPLOADS_DIR, m[1], m[2]);
  if (!file || !fs.existsSync(file)) {
    refuse(ws, 'NOT_FOUND', 'That image is gone');
    return null;
  }
  const buffer = fs.readFileSync(file);
  const size = imageSize(buffer);
  if (!size) {
    refuse(ws, 'NOT_FOUND', 'That image can’t be upscaled');
    return null;
  }
  const factor = Math.min(UPSCALE_FACTOR, UPSCALE_MAX_SIDE / Math.max(size.width, size.height));
  if (factor < MIN_UPSCALE) {
    refuse(ws, 'TOO_BIG', `That image is already about as big as upscaling goes (${UPSCALE_MAX_SIDE} px)`);
    return null;
  }
  const ext = m[3].toLowerCase().replace('jpeg', 'jpg');
  const contentType = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }[ext];
  return { url, request: { buffer, contentType, ext, width: size.width, height: size.height, factor: Math.round(factor * 1000) / 1000 } };
}

function imagineOp({ ws, msg, userId }) {
  const space = db.getSpaceByName(msg.space);
  const type = space ? db.channelType(msg.space, msg.channel) : null;
  if (!space || !db.isMember(space.id, userId) || (type !== 'text' && type !== 'thread')) return refuse(ws, 'NOT_ALLOWED', 'You can’t post there');
  if (!canViewChannel(msg.space, msg.channel, userId) || !canPostChannel(msg.space, msg.channel, userId)) return refuse(ws, 'NOT_ALLOWED', 'You can’t post there');
  const settings = getSettings();
  if (!db.getSpaceImagine(space.id)?.enabled) return refuse(ws, 'DISABLED', '/imagine is off in this server');
  const engines = enabledEngines(settings);
  if (!engines.length) return refuse(ws, 'NO_ENGINE', 'No image engine is set up on this instance');
  if (!canDoAction(space.id, userId, 'generate_images')) return refuse(ws, 'NO_PERMISSION', 'You aren’t allowed to generate images here');
  // Retry / Variations (P3-23): `from` names one of the bot's messages in this
  // channel; its finished job's prompt and options are used again.
  let source = null;
  if (msg.from != null) {
    source = db.getImagineJobByMessage(Number(msg.from));
    const here = db.channelRef(msg.space, msg.channel);
    if (!source || source.space_id !== space.id || source.channel_id !== here?.channelId || !['done', 'failed'].includes(source.status)) {
      return refuse(ws, 'NOT_FOUND', 'That image request can’t be repeated');
    }
  }
  // Starting from a picture (P3-36b): msg.init, or Retry of a failed one.
  const fromPicture = (!source && msg.init != null) || (!!source && source.kind === 'img2img' && source.status === 'failed');
  let picture = null;
  if (fromPicture) {
    picture = initSource(ws, msg, source);
    if (!picture) return;
  }
  // Variations (P3-36a): Subtle / Strong on a finished image, or Retry of a failed one.
  const varying = !fromPicture && !!source && (Object.hasOwn(VARY, msg.vary) || (source.kind === 'vary' && source.status === 'failed'));
  let vary = null;
  if (varying) {
    vary = varySource(ws, msg, source);
    if (!vary) return;
  }
  // Upscale (P3-29): the button on a finished image, or Retry of a failed upscale.
  const upscaling = !varying && !fromPicture && !!source && (msg.upscale === true || (source.kind === 'upscale' && source.status === 'failed'));
  let upscale = null;
  if (upscaling) {
    upscale = upscaleSource(ws, msg, source);
    if (!upscale) return;
  }
  const prompt = source ? source.prompt : typeof msg.prompt === 'string' ? msg.prompt.trim() : '';
  if (!prompt || prompt.length > MAX_PROMPT) return refuse(ws, 'BAD_PROMPT', `Prompts are 1–${MAX_PROMPT} characters`);
  const shape = picture ? picture.shape : source ? source.shape : msg.shape || 'square';
  const quality = source ? source.quality : msg.quality || 'standard';
  if (!SHAPES.includes(shape) || !QUALITIES.includes(quality)) return refuse(ws, 'BAD_OPTION', 'Unknown shape or quality');
  const fallback = () => engines.find((e) => e.id === settings.defaultEngine) || engines[0];
  if (upscaling && !engines.some((e) => e.id === 'comfyui')) return refuse(ws, 'NO_ENGINE', 'Upscaling needs ComfyUI with an upscale model (Settings → Image generation)');
  if (varying && !engines.some((e) => e.id === 'comfyui')) return refuse(ws, 'NO_ENGINE', 'Variations from an image need ComfyUI (Settings → Image generation)');
  if (fromPicture && !engines.some((e) => e.id === 'comfyui')) return refuse(ws, 'NO_ENGINE', 'Starting from a picture needs ComfyUI (Settings → Image generation)');
  const engine = upscaling || varying || fromPicture
    ? engines.find((e) => e.id === 'comfyui')
    : source
    ? engines.find((e) => e.id === source.engine) || fallback() // the same engine while it's still on
    : msg.engine
      ? engines.find((e) => e.id === msg.engine)
      : fallback();
  if (!engine) return refuse(ws, 'BAD_OPTION', 'That engine isn’t available');
  const limit = limitInfo(space.id, settings);
  if (usedToday(userId) >= limit.limit) return refuse(ws, 'LIMIT', limitMessage(msg.space, limit));
  const refused = upscaling ? null : refusedReason(prompt); // an upscale makes nothing new
  if (refused) return refuse(ws, 'REFUSED', refused);

  const config = engineConfig(settings, engine.id);
  const request = { prompt, shape, quality, ...(upscale ? { upscale: upscale.request } : {}), ...(vary ? { init: vary.request } : {}), ...(picture ? { init: picture.request } : {}) };
  const permissive = !!settings.permissive && db.isChannelNsfw(msg.space, msg.channel);
  const ref = db.channelRef(msg.space, msg.channel);
  const user = db.getUserById(userId);
  const cost = engine.costOf(request, config);
  if (overBudget(engine, config, cost)) return refuse(ws, 'BUDGET', `This instance's ${engine.name} budget for the month is used up`);
  const job = {
    engine, config, request, permissive, cost,
    space: msg.space, channel: msg.channel, username: user.username, kind: upscale ? 'upscale' : vary ? 'vary' : picture ? 'img2img' : 'generate',
    vary: vary ? vary.name : null,
  };
  job.id = db.createImagineJob({
    userId, spaceId: space.id, channelId: ref.channelId, engine: engine.id, prompt, shape, quality, permissive, cost: job.cost,
    kind: job.kind, sourceUrl: upscale ? upscale.url : vary ? vary.url : picture ? picture.url : null,
    strength: vary ? vary.strength : picture ? picture.strength : null,
  });
  const content = runner.text.queued(job, runner.placeFor(engine.id));
  const stored = db.postAsBot(msg.space, msg.channel, content);
  job.messageId = Number(stored.id);
  db.updateImagineJob(job.id, { messageId: job.messageId });
  const bot = db.getUserById(db.ensureImagineBot());
  const thread = type === 'thread' ? db.getThread(msg.space, msg.channel) : null;
  deliverToChannelViewers(msg.space, msg.channel, JSON.stringify({
    type: 'message', id: job.messageId, space: msg.space, channel: msg.channel,
    author: bot.username, authorId: bot.id, authorAvatar: null, bot: true,
    content, attachments: [], spoiler: false, mentions: [], replyTo: null, timestamp: stored.timestamp,
    thread: thread ? { name: thread.name, parentChannel: thread.parentChannel } : undefined,
  }));
  if (thread) require('../gateway/chat').threadUpdated(msg.space, msg.channel);
  if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'imagine_queued', jobId: job.id, messageId: job.messageId, space: msg.space, channel: msg.channel }));
  runner.enqueue(job);
}

// An admin's test image (P2-20b): straight from one engine, with its saved
// config — no chat message, no daily count, but the same always-refused check.
async function tryEngine({ engine: id, prompt, shape = 'square', quality = 'standard' } = {}, adminId = null) {
  const settings = getSettings();
  const engine = ENGINES.get(id);
  if (!engine || !engine.available()) return { error: `Unknown engine: ${id}` };
  const text = typeof prompt === 'string' ? prompt.trim() : '';
  if (!text || text.length > MAX_PROMPT) return { error: `Prompts are 1–${MAX_PROMPT} characters` };
  if (!SHAPES.includes(shape) || !QUALITIES.includes(quality)) return { error: 'Unknown shape or quality' };
  const refused = refusedReason(text);
  if (refused) return { error: refused };
  const config = engineConfig(settings, id);
  const cost = engine.costOf({ prompt: text, shape, quality }, config);
  if (overBudget(engine, config, cost)) return { error: `This instance's ${engine.name} budget for the month is used up` };
  // Recorded like a chat request (without a server), so the price and the
  // monthly spend stay right; it doesn't count against anyone's daily images.
  const jobId = db.createImagineJob({ userId: adminId || null, spaceId: null, channelId: null, engine: id, prompt: text, shape, quality, permissive: false, cost });
  const started = Date.now();
  const signal = AbortSignal.timeout(parseInt(process.env.IMAGINE_TIMEOUT_MS, 10) || 5 * 60 * 1000);
  try {
    const result = await engine.generate({ prompt: text, shape, quality }, config, { permissive: !!settings.permissive, signal });
    const [url] = runner.saveImages(result.images);
    db.updateImagineJob(jobId, { status: 'done', finishedAt: Date.now(), model: result.model || null, cost: result.cost ?? cost });
    return { url, width: result.width || null, height: result.height || null, model: result.model || null, cost: result.cost ?? null, ms: Date.now() - started };
  } catch (err) {
    const reason = signal.aborted ? 'It took too long' : err.message || 'Something went wrong';
    db.updateImagineJob(jobId, { status: 'failed', finishedAt: Date.now(), error: reason });
    return { error: reason };
  }
}

runner.setDeliver((space, channel, frame) => deliverToChannelViewers(space, channel, JSON.stringify(frame)));

// Start-up: the bot exists, and jobs a restart cut off are marked failed.
function start() {
  db.ensureImagineBot();
  runner.recover();
}

module.exports = { imagineOp, tryEngine, decorateSpaces, getSettings, updateSettings, adminView, dailyLimitFor, start, idle: runner.idle, ENGINES, SHAPES, QUALITIES };
