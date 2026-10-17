// Link previews: after a message is stored and delivered, find its links,
// fetch a card for each (safely: integrations/unfurl -> net/safeFetch), save
// them, and tell the people who can see the message. Never blocks sending.
//
//   handleMessage({ kind, messageId, content, userId, deliver, edited })
//     kind: 'channel' | 'dm'; deliver(embeds) sends the frame to the right
//     people. On an edit the cards are recomputed (a removed link loses its
//     card, and an empty list is sent so clients drop it).
//
// On by default. LINK_PREVIEWS=off changes that default; a site admin's
// choice (a stored setting) wins over both.

const db = require('./db');
const { unfurl } = require('./integrations/unfurl');
const { rateLimitOk } = require('./auth/rateLimit');
const { publicCard } = require('./net/imageProxy');

const MAX_URLS = 3;
const FRESH_MS = 24 * 60 * 60 * 1000; // reuse a card for a day
const RETRY_FAILED_MS = 60 * 60 * 1000; // a failed fetch is retried after an hour
const CONCURRENCY = 4; // fetches in flight across the whole server
const PER_USER = { max: 30, windowMs: 10 * 60 * 1000 }; // new fetches a user can cause

function enabled() {
  const stored = db.getSetting('link_previews');
  const value = stored ?? process.env.LINK_PREVIEWS ?? 'on';
  return String(value).toLowerCase() !== 'off';
}

function setEnabled(on) {
  db.setSetting('link_previews', on ? 'on' : 'off');
}

// ---- Finding links (same rules as the client's autolinker, web/src/markdown.jsx) ----
const URL_STOP = /[\s<>"`]/;
const TRAILING_PUNCT = new Set(['.', ',', ';', ':', '!', '?', "'", '"']);

function readUrl(text, i) {
  let end = i;
  while (end < text.length && !URL_STOP.test(text[end])) end += 1;
  let url = text.slice(i, end);
  for (;;) {
    const last = url[url.length - 1];
    if (TRAILING_PUNCT.has(last)) url = url.slice(0, -1);
    else if (last === ')' && (url.match(/\(/g) || []).length < (url.match(/\)/g) || []).length) url = url.slice(0, -1);
    else break;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (url.length <= parsed.protocol.length + 2) return null;
  } catch {
    return null;
  }
  return url;
}

// Up to 3 distinct http(s) links, skipping code, ||spoilers|| and <links>
// (wrapping a link in <> is the way to say "no preview").
function extractUrls(content) {
  const text = String(content || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/\|\|[\s\S]*?\|\|/g, ' ')
    .replace(/<https?:\/\/[^>\s]*>/gi, ' ');
  const out = [];
  const re = /https?:\/\//gi;
  let m;
  while ((m = re.exec(text)) && out.length < MAX_URLS) {
    if (m.index > 0 && /[\w]/.test(text[m.index - 1])) continue; // glued to a word
    const url = readUrl(text, m.index);
    if (url && !out.includes(url)) out.push(url);
    if (url) re.lastIndex = m.index + url.length;
  }
  return out;
}

// ---- Fetching, with a cache, a global concurrency cap and per-user limits ----
let active = 0;
const waiting = [];
const inflight = new Map(); // url -> Promise<card|null>
const pending = new Set(); // whole message jobs, for idle()

function limited(fn) {
  return new Promise((resolve, reject) => {
    const run = () => {
      active += 1;
      fn().then(resolve, reject).finally(() => {
        active -= 1;
        waiting.shift()?.();
      });
    };
    if (active < CONCURRENCY) run();
    else waiting.push(run);
  });
}

function fetchOptions() {
  // Lets the test suite preview its own local server; safeFetch ignores this
  // unless NODE_ENV is 'test'.
  return { allowLoopback: process.env.LINK_PREVIEWS_ALLOW_LOOPBACK === '1' };
}

async function cardFor(url, userId) {
  const cached = db.getLinkPreview(url);
  if (cached) {
    const age = Date.now() - cached.fetchedAt;
    if (cached.ok && age < FRESH_MS) return cached.card;
    if (!cached.ok && age < RETRY_FAILED_MS) return null;
  }
  if (inflight.has(url)) return inflight.get(url);
  if (!rateLimitOk(`unfurl:${userId}`, PER_USER.max, PER_USER.windowMs)) return cached?.card || null;
  const p = limited(() => unfurl(url, fetchOptions()))
    .catch(() => null)
    .then((card) => {
      db.saveLinkPreview(url, card);
      return card;
    })
    .finally(() => inflight.delete(url));
  inflight.set(url, p);
  return p;
}

function handleMessage({ kind, messageId, content, userId, deliver, edited = false }) {
  if (!messageId || !enabled()) return;
  const urls = extractUrls(content);
  const had = edited ? db.getEmbedUrls(kind, messageId).length : 0;
  if (urls.length === 0 && had === 0) return;

  const job = (async () => {
    const cards = await Promise.all(urls.map((u) => cardFor(u, userId).catch(() => null)));
    const shown = urls.map((url, i) => ({ url, card: cards[i] })).filter((x) => x.card);
    if (shown.length === 0 && had === 0) return;
    if (!db.messageExists(kind, messageId)) return; // deleted while we were fetching
    db.setEmbeds(kind, messageId, shown.map((x) => x.url));
    deliver(shown.map((x) => publicCard(x.card))); // images go through our proxy
  })().catch((err) => console.warn('[link previews]', err.message));
  pending.add(job);
  job.finally(() => pending.delete(job));
}

// Resolves once every preview job started so far has finished (for tests).
async function idle() {
  while (pending.size) await Promise.allSettled([...pending]);
}

module.exports = { handleMessage, extractUrls, enabled, setEnabled, idle };
