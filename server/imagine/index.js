// /imagine (P2-20): settings, who may use it, and the `imagine` gateway op.
// Engines live in ./engines (fake here; ComfyUI and kie.ai in P2-20b/c) and
// share one request shape: { prompt, shape, quality }. The runner queues the
// jobs and turns the bot's placeholder into the image.
const db = require('../db');
const { canViewChannel, canPostChannel, canDoAction } = require('../permissions');
const { deliverToChannelViewers } = require('../gateway/delivery');
const { refusedReason } = require('./promptCheck');
const runner = require('./runner');

const ENGINES = new Map([['fake', require('./engines/fake')]]);
const SHAPES = ['square', 'portrait', 'landscape', 'wide'];
const QUALITIES = ['draft', 'standard', 'high'];
const MAX_PROMPT = 1000;
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
    engines: [...ENGINES.values()].filter((e) => e.available()).map((e) => ({ id: e.id, name: e.name, config: e.publicConfig(engineConfig(settings, e.id)) })),
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
  const own = db.getSpaceImagine(spaceId)?.dailyLimit;
  return Math.min(own ?? settings.dailyLimit, settings.dailyCeiling);
}
const usedToday = (userId) => db.countImagineJobsSince(userId, Date.now() - DAY_MS);

// GET /spaces gains `imagine` per server: whether it's on here, whether I may
// use it, my limit and use, and the engines to choose from.
function decorateSpaces(list, userId) {
  const settings = getSettings();
  const engines = enabledEngines(settings).map((e) => ({ id: e.id, name: e.name }));
  const used = usedToday(userId);
  return list.map((s) => {
    const space = db.getSpaceByName(s.name);
    const own = space ? db.getSpaceImagine(space.id) : null;
    return {
      ...s,
      imagine: {
        enabled: !!(own && own.enabled && engines.length),
        serverEnabled: !!(own && own.enabled),
        canUse: !!(space && canDoAction(space.id, userId, 'generate_images')),
        dailyLimit: space ? dailyLimitFor(space.id, settings) : 0,
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
  const prompt = typeof msg.prompt === 'string' ? msg.prompt.trim() : '';
  if (!prompt || prompt.length > MAX_PROMPT) return refuse(ws, 'BAD_PROMPT', `Prompts are 1–${MAX_PROMPT} characters`);
  const shape = msg.shape || 'square';
  const quality = msg.quality || 'standard';
  if (!SHAPES.includes(shape) || !QUALITIES.includes(quality)) return refuse(ws, 'BAD_OPTION', 'Unknown shape or quality');
  const engine = msg.engine
    ? engines.find((e) => e.id === msg.engine)
    : engines.find((e) => e.id === settings.defaultEngine) || engines[0];
  if (!engine) return refuse(ws, 'BAD_OPTION', 'That engine isn’t available');
  const limit = dailyLimitFor(space.id, settings);
  if (usedToday(userId) >= limit) return refuse(ws, 'LIMIT', `You’ve used all ${limit} images for today`);
  const refused = refusedReason(prompt);
  if (refused) return refuse(ws, 'REFUSED', refused);

  const config = engineConfig(settings, engine.id);
  const request = { prompt, shape, quality };
  const permissive = !!settings.permissive && db.isChannelNsfw(msg.space, msg.channel);
  const ref = db.channelRef(msg.space, msg.channel);
  const user = db.getUserById(userId);
  const job = {
    engine, config, request, permissive, cost: engine.costOf(request, config),
    space: msg.space, channel: msg.channel, username: user.username,
  };
  job.id = db.createImagineJob({
    userId, spaceId: space.id, channelId: ref.channelId, engine: engine.id, prompt, shape, quality, permissive, cost: job.cost,
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

runner.setDeliver((space, channel, frame) => deliverToChannelViewers(space, channel, JSON.stringify(frame)));

// Start-up: the bot exists, and jobs a restart cut off are marked failed.
function start() {
  db.ensureImagineBot();
  runner.recover();
}

module.exports = { imagineOp, decorateSpaces, getSettings, updateSettings, adminView, dailyLimitFor, start, idle: runner.idle, ENGINES, SHAPES, QUALITIES };
