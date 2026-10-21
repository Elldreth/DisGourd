// Sending email (P12-01). Settings come from the environment only, and the
// SMTP password never leaves this file: it isn't logged, returned or stored.
// Mail goes into an in-memory queue, one send at a time, with retries, a daily
// cap and a per-recipient limit, so a request never waits on the mail server
// and the server can't be used to flood an inbox. Pending mail is lost on a
// restart (the person can ask again).
//
//   SMTP_HOST, SMTP_PORT (587 STARTTLS, required; 465 TLS), SMTP_USER,
//   SMTP_PASS or SMTP_PASS_FILE, MAIL_FROM, MAIL_REPLY_TO (optional),
//   PUBLIC_URL (links in mail), MAIL_DAILY_LIMIT (default 90),
//   MAIL_SERVER_NAME (default "DisGourd").
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { secretFromEnv } = require('../secrets');

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const PER_RECIPIENT_HOUR = 5;
// Back-off before attempts 2 and 3. MAIL_RETRY_MS (comma-separated) is for tests.
const retryDelays = () => (process.env.MAIL_RETRY_MS ? process.env.MAIL_RETRY_MS.split(',').map(Number) : [60e3, 5 * 60e3]);
const MAX_ATTEMPTS = 3;

// ---- settings ----

function settings(env = process.env) {
  const host = String(env.SMTP_HOST || '').trim();
  const port = parseInt(env.SMTP_PORT, 10) || 587;
  const user = String(env.SMTP_USER || '').trim();
  let pass = '';
  let passError = null;
  try {
    pass = secretFromEnv('SMTP_PASS', env);
  } catch (err) {
    passError = err.message; // names the file, never its contents
  }
  const from = String(env.MAIL_FROM || '').trim();
  const replyTo = String(env.MAIL_REPLY_TO || '').trim() || null;
  const publicUrl = String(env.PUBLIC_URL || '').trim().replace(/\/+$/, '');
  const dailyLimit = Math.max(0, parseInt(env.MAIL_DAILY_LIMIT, 10) || 90);
  const serverName = String(env.MAIL_SERVER_NAME || '').trim() || 'DisGourd';
  const missing = [];
  if (!host) missing.push('SMTP_HOST');
  if (!from) missing.push('MAIL_FROM');
  if (!publicUrl) missing.push('PUBLIC_URL');
  if (user && !pass) missing.push(passError ? 'SMTP_PASS_FILE (unreadable)' : 'SMTP_PASS or SMTP_PASS_FILE');
  return { host, port, user, pass, from, replyTo, publicUrl, dailyLimit, serverName, missing, passError };
}

const enabled = () => settings().missing.length === 0;

// The address part of MAIL_FROM ("Name <a@b>" or "a@b").
const addressOf = (from) => {
  const m = /<([^>]+)>/.exec(from);
  return (m ? m[1] : from).trim();
};
const domainOf = (addr) => String(addr).split('@').pop().toLowerCase();
const looksLikeEmail = (s) => typeof s === 'string' && s.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(s);

// ---- transport ----

let transport = null;
let transportKey = '';
let injected = null; // tests

function getTransport(s) {
  if (injected) return injected;
  const key = [s.host, s.port, s.user, s.pass].join('\u0000');
  if (!transport || key !== transportKey) {
    const secure = s.port === 465 || s.port === 2465; // TLS from the start
    transport = nodemailer.createTransport({
      host: s.host,
      port: s.port,
      secure,
      requireTLS: !secure, // 587/2587: STARTTLS or nothing, never plain text
      auth: s.user ? { user: s.user, pass: s.pass } : undefined,
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 30000,
    });
    transportKey = key;
  }
  return transport;
}

// Take the password (and its SMTP AUTH encodings) out of any text.
function redact(text, s = settings()) {
  let out = String(text == null ? '' : text);
  if (s.pass) {
    const secrets = [s.pass, Buffer.from(s.pass).toString('base64'), Buffer.from(`\u0000${s.user}\u0000${s.pass}`).toString('base64')];
    for (const secret of secrets) out = out.split(secret).join('[redacted]');
  }
  return out.slice(0, 300);
}

// ---- today's counts ----

let today = { day: '', sent: 0, failed: 0, overCap: 0, overRecipient: 0, queued: 0 };
let lastError = null; // { at, message }
const recent = new Map(); // recipient -> [timestamps in the last hour]

function counts() {
  const day = new Date().toISOString().slice(0, 10);
  if (today.day !== day) today = { day, sent: 0, failed: 0, overCap: 0, overRecipient: 0, queued: 0 };
  return today;
}

// ---- the queue ----

const queue = [];
let busy = false;
let waiting = 0; // retries scheduled for later

function send({ to, subject, text, html }) {
  const s = settings();
  if (s.missing.length) return { queued: false, reason: 'off' };
  if (!looksLikeEmail(to)) return { queued: false, reason: 'address' };
  const c = counts();
  if (c.queued >= s.dailyLimit) {
    c.overCap += 1;
    console.warn(`[mail] daily limit (${s.dailyLimit}) reached; not sending "${subject}" to …@${domainOf(to)}`);
    return { queued: false, reason: 'cap' };
  }
  const key = to.toLowerCase();
  const now = Date.now();
  const times = (recent.get(key) || []).filter((t) => now - t < HOUR_MS);
  if (times.length >= PER_RECIPIENT_HOUR) {
    c.overRecipient += 1;
    console.warn(`[mail] ${PER_RECIPIENT_HOUR} emails to one address this hour; not sending "${subject}" to …@${domainOf(to)}`);
    return { queued: false, reason: 'recipient' };
  }
  times.push(now);
  recent.set(key, times);
  c.queued += 1;
  queue.push({ to, subject, text, html, attempt: 1 });
  setImmediate(pump);
  return { queued: true };
}

async function pump() {
  if (busy) return;
  const item = queue.shift();
  if (!item) return;
  busy = true;
  const s = settings();
  try {
    await getTransport(s).sendMail({
      from: s.from,
      ...(s.replyTo ? { replyTo: s.replyTo } : {}),
      to: item.to,
      subject: item.subject,
      text: item.text,
      html: item.html,
      messageId: `<${crypto.randomUUID()}@${domainOf(addressOf(s.from))}>`,
      date: new Date(),
      headers: { 'Auto-Submitted': 'auto-generated' },
    });
    counts().sent += 1;
    console.log(`[mail] sent "${item.subject}" to …@${domainOf(item.to)}`);
  } catch (err) {
    const message = redact(err && (err.response || err.message || err.code), s);
    if (item.attempt < MAX_ATTEMPTS) {
      const delay = retryDelays()[item.attempt - 1] ?? 60e3;
      console.warn(`[mail] "${item.subject}" to …@${domainOf(item.to)} failed (attempt ${item.attempt}): ${message}; retrying`);
      waiting += 1;
      setTimeout(() => {
        waiting -= 1;
        queue.push({ ...item, attempt: item.attempt + 1 });
        pump();
      }, delay).unref?.();
    } else {
      counts().failed += 1;
      lastError = { at: Date.now(), message };
      console.warn(`[mail] gave up on "${item.subject}" to …@${domainOf(item.to)} after ${MAX_ATTEMPTS} attempts: ${message}`);
    }
  } finally {
    busy = false;
    if (queue.length) setImmediate(pump);
  }
}

// ---- what the admin page shows ----

function status() {
  const s = settings();
  const c = counts();
  return {
    enabled: s.missing.length === 0,
    missing: s.missing,
    from: s.from || null,
    server: s.host ? `${s.host}:${s.port}` : null,
    tls: s.port === 465 || s.port === 2465 ? 'tls' : 'starttls',
    publicUrl: s.publicUrl || null,
    dailyLimit: s.dailyLimit,
    today: { sent: c.sent, failed: c.failed, overCap: c.overCap, overRecipient: c.overRecipient, pending: queue.length + waiting + (busy ? 1 : 0) },
    lastError,
  };
}

// Tests: swap the transport, wait for the queue, start afresh.
const idle = () => !busy && queue.length === 0 && waiting === 0;
function _setTransport(t) {
  injected = t;
}
function _reset() {
  queue.length = 0;
  recent.clear();
  today = { day: '', sent: 0, failed: 0, overCap: 0, overRecipient: 0, queued: 0 };
  lastError = null;
  transport = null;
  transportKey = '';
}

module.exports = { enabled, settings, send, status, idle, redact, looksLikeEmail, _setTransport, _reset, _getTransport: getTransport };
