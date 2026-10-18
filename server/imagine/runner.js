// The /imagine job runner (P2-20a): one job at a time per engine, in arrival
// order. Each job's placeholder message shows its place in line, then
// "generating…", then the image (or why it failed). Jobs give up after
// IMAGINE_TIMEOUT_MS (5 minutes by default).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../db');
const { UPLOADS_DIR } = require('../routes/uploads');

const timeoutMs = () => parseInt(process.env.IMAGINE_TIMEOUT_MS, 10) || 5 * 60 * 1000;
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const ORDINAL = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;

// The placeholder's text at each stage.
const text = {
  queued: (job, place) => `🎨 Imagining for **${job.username}**… ${ORDINAL(place)} in line`,
  running: (job) => `🎨 Imagining for **${job.username}**… generating`,
  done: (job) => `🎨 **${job.username}** imagined: ${job.request.prompt}`,
  failed: (job, reason) => `⚠️ Couldn't imagine that for **${job.username}**: ${reason}`,
};

const lanes = new Map(); // engine id -> { running: job | null, queue: [job] }
let deliver = () => {}; // (space, channel, frame) — set by index.js

function lane(id) {
  if (!lanes.has(id)) lanes.set(id, { running: null, queue: [] });
  return lanes.get(id);
}

// Rewrite a job's placeholder and tell the channel.
function show(job, content, attachments = []) {
  if (!db.updateBotMessage(job.messageId, content, attachments)) return;
  deliver(job.space, job.channel, { type: 'message_update', id: job.messageId, space: job.space, channel: job.channel, content, attachments, editedAt: null });
}

// Places in line: the running job counts as first.
function refreshPlaces(l) {
  l.queue.forEach((job, i) => show(job, text.queued(job, i + (l.running ? 2 : 1))));
}

// Where a new job will stand (1 = next).
function placeFor(engineId) {
  const l = lane(engineId);
  return l.queue.length + (l.running ? 2 : 1);
}

function saveImages(images) {
  const token = crypto.randomBytes(9).toString('hex');
  const dir = path.join(UPLOADS_DIR, token);
  fs.mkdirSync(dir, { recursive: true });
  return images.map((img, i) => {
    const name = `imagine-${i + 1}.${EXT[img.contentType] || 'png'}`;
    fs.writeFileSync(path.join(dir, name), img.buffer);
    return `/uploads/${token}/${name}`;
  });
}

async function run(job) {
  const l = lane(job.engine.id);
  l.running = job;
  db.updateImagineJob(job.id, { status: 'running', startedAt: Date.now() });
  show(job, text.running(job));
  refreshPlaces(l);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs());
  try {
    const result = await job.engine.generate(job.request, job.config, { permissive: job.permissive, signal: ac.signal });
    if (!result || !Array.isArray(result.images) || !result.images.length) throw Object.assign(new Error('No image came back'), { code: 'ENGINE' });
    const urls = saveImages(result.images);
    db.updateImagineJob(job.id, { status: 'done', finishedAt: Date.now(), model: result.model || null, cost: result.cost ?? job.cost });
    show(job, text.done(job), urls);
  } catch (err) {
    const reason = ac.signal.aborted ? 'it took too long' : err.code === 'REFUSED' ? 'the engine refused this prompt' : err.message || 'something went wrong';
    db.updateImagineJob(job.id, { status: 'failed', finishedAt: Date.now(), error: reason });
    show(job, text.failed(job, reason));
  } finally {
    clearTimeout(timer);
    l.running = null;
    next(job.engine.id);
  }
}

function next(engineId) {
  const l = lane(engineId);
  if (l.running || !l.queue.length) return;
  run(l.queue.shift());
}

// Queue a job: { id, engine, config, request, permissive, cost, space,
// channel, messageId, username }.
function enqueue(job) {
  lane(job.engine.id).queue.push(job);
  next(job.engine.id);
}

// After a restart, jobs that were waiting or running are gone: say so.
function recover() {
  for (const j of db.getUnfinishedImagineJobs()) {
    db.updateImagineJob(j.id, { status: 'failed', finishedAt: Date.now(), error: 'the server restarted' });
    const who = db.getUserById(j.user_id);
    if (j.message_id) db.updateBotMessage(j.message_id, text.failed({ username: who ? who.username : 'someone' }, 'the server restarted'));
  }
}

// Whether anything is queued or running (tests wait on this).
const idle = () => [...lanes.values()].every((l) => !l.running && !l.queue.length);

module.exports = { enqueue, placeFor, recover, idle, text, setDeliver: (fn) => (deliver = fn) };
