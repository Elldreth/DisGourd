const url = require('url');
const db = require('../db');
const { verifyToken } = require('../auth/tokens');
const { gated } = require('../auth/emailGate');
const { userClients, broadcastPresence, sendToUser } = require('./delivery');
const { voiceLeave, voiceStatesFor } = require('./voice');
const { handleGatewayMessage } = require('./router');
const { threadUpdated } = require('./chat');
const { config } = require('../config');
const { tooManySockets } = require('./limits');
const { clientIp } = require('../net/clientIp');

// Per-connection lifecycle chatter is silenced under test to keep output clean
// and to avoid "log after teardown" noise; warnings and errors still print.
const isTest = process.env.NODE_ENV === 'test';
function logInfo(...args) { if (!isTest) console.log(...args); }

function detachGateway(ws) {
  voiceLeave(ws);
  const set = userClients[ws.userId];
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) {
    delete userClients[ws.userId];
    broadcastPresence(ws.userId); // now offline
  }
}

// Clear custom statuses whose time is up and tell everyone (run every minute;
// also exported for tests). Returns the ids that were cleared.
function sweepExpiredStatuses() {
  const ids = db.clearExpiredStatuses();
  for (const id of ids) {
    broadcastPresence(id);
    sendToUser(id, JSON.stringify({ type: 'my_status', statusText: null, statusEmoji: null, statusExpiresAt: null }));
  }
  return ids;
}

// Archive threads quiet for longer than THREAD_ARCHIVE_DAYS and tell the
// parent channels' viewers (run hourly and at start-up; also exported for
// tests). Returns the archived threads.
function sweepQuietThreads(now = Date.now()) {
  const archived = db.archiveQuietThreads(now - config.threadArchiveDays * 24 * 60 * 60 * 1000, now);
  for (const t of archived) threadUpdated(t.space, t.channel);
  return archived;
}

// Wire the gateway onto the HTTP server: authenticate the /gateway upgrade,
// send the connect frames, route incoming frames, and run the heartbeat.
function attachGateway(httpServer, wss) {
  // ---- Heartbeat ----
  // Ping every client periodically; any socket that fails to answer with a pong
  // before the next tick is considered dead and torn down. This is what keeps
  // presence accurate when a client vanishes without a clean close (crash, lost
  // wifi, laptop sleep) rather than leaving a "ghost" online forever.
  const HEARTBEAT_INTERVAL_MS = 30000;
  const heartbeatTimer = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        detachGateway(ws);
        return ws.terminate();
      }
      ws.isAlive = false;
      try { ws.ping(); } catch { /* socket already closing */ }
    });
  }, HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref(); // don't keep the process (or tests) alive just for this
  const statusTimer = setInterval(sweepExpiredStatuses, 60000);
  statusTimer.unref();
  const threadTimer = setInterval(sweepQuietThreads, 60 * 60 * 1000);
  threadTimer.unref();
  setImmediate(sweepQuietThreads); // catch up after a restart
  const reverifyTimer = setInterval(() => reverifySockets(wss), gatewayAuth.reverifyMs);
  reverifyTimer.unref();
  wss.on('close', () => {
    clearInterval(heartbeatTimer);
    clearInterval(statusTimer);
    clearInterval(threadTimer);
    clearInterval(reverifyTimer);
  });

  httpServer.on('upgrade', (request, socket, head) => {
    const parsedUrl = url.parse(request.url, true);
    if (parsedUrl.pathname !== '/gateway') {
      socket.destroy();
      return;
    }
    // L5: a browser on another site can't open a socket here.
    if (!originAllowed(request)) {
      refuse(socket, 403, 'Forbidden');
      return;
    }
    // The old client put the token in the URL. Still accepted for one release
    // (tabs open across the update), but it ends up in logs: deprecated.
    const legacyToken = parsedUrl.query && parsedUrl.query.token;
    if (legacyToken) {
      const payload = verifyToken(legacyToken);
      if (!payload) {
        socket.destroy();
        return;
      }
      if (tooManySockets(openFor(payload.sub))) {
        refuse(socket, 429, 'Too Many Requests');
        return;
      }
      warnLegacy();
      wss.handleUpgrade(request, socket, head, (ws) => admit(ws, payload, legacyToken));
      return;
    }
    // P11-07: no token yet. The first frame must be { op: 'auth', token }
    // within gatewayAuth.timeoutMs; until then nothing is sent and other ops
    // are ignored. Sockets waiting to sign in are capped per address.
    const ip = clientIp(request);
    if ((pending.get(ip) || 0) >= gatewayAuth.maxPendingPerIp) {
      refuse(socket, 429, 'Too Many Requests');
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => awaitAuth(ws, ip));
  });
}

// P11-13 (L4): a signed-in socket stays open only while its token still
// verifies (not expired, not signed out, not suspended). Exported for tests.
function reverifySockets(wss) {
  wss.clients.forEach((ws) => {
    if (!ws.userId || !ws.token || verifyToken(ws.token)) return;
    try {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'signed_out', reason: 'expired' }));
      ws.close(4001, 'Sign in again');
    } catch {
      /* already closing */
    }
  });
}

// ---- Signing in (P11-07) ----
const gatewayAuth = { timeoutMs: 5000, maxPendingPerIp: 20, reverifyMs: 30 * 60 * 1000 }; // tests lower these
const pending = new Map(); // address -> sockets waiting for their auth frame

const openFor = (userId) => (userClients[userId] ? userClients[userId].size : 0);
function refuse(socket, status, text) {
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

// An upgrade without Origin (not a browser) is allowed. A browser's Origin
// must name this host (Host, or a proxy's X-Forwarded-Host: a page can't set
// either on a WebSocket) or be listed in ALLOWED_ORIGINS.
function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const listed = String(process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (listed.includes(origin)) return true;
  let host;
  try {
    host = new URL(origin).host.toLowerCase();
  } catch {
    return false;
  }
  const first = (v) => String(v || '').split(',')[0].trim().toLowerCase();
  return !!host && (host === first(req.headers.host) || host === first(req.headers['x-forwarded-host']));
}

let legacyWarnedAt = 0;
function warnLegacy() {
  if (isTest || Date.now() - legacyWarnedAt < 60 * 60 * 1000) return;
  legacyWarnedAt = Date.now();
  console.warn('[gateway] A socket signed in with ?token= in the URL (an old client still open). Deprecated: it will stop working in a later release');
}

function awaitAuth(ws, ip) {
  pending.set(ip, (pending.get(ip) || 0) + 1);
  let waiting = true;
  const done = () => {
    if (!waiting) return;
    waiting = false;
    clearTimeout(timer);
    const left = (pending.get(ip) || 1) - 1;
    if (left > 0) pending.set(ip, left);
    else pending.delete(ip);
  };
  const timer = setTimeout(() => {
    done();
    ws.close(4001, 'Sign in again');
  }, gatewayAuth.timeoutMs);
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('close', done);
  ws.on('error', done);
  const onFirst = (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return; // ignored, like any other frame before auth
    }
    if (!msg || msg.op !== 'auth') return;
    ws.off('message', onFirst);
    done();
    const payload = typeof msg.token === 'string' ? verifyToken(msg.token) : null;
    if (!payload) {
      ws.close(4001, 'Sign in again');
      return;
    }
    // P11-03: at most MAX_SOCKETS_PER_USER open sockets each; the newest is refused.
    if (tooManySockets(openFor(payload.sub))) {
      ws.close(1008, 'Too many connections');
      return;
    }
    admit(ws, payload, msg.token);
  };
  ws.on('message', onFirst);
}

// A signed-in socket: register it, send the connect frames, route its frames.
function admit(ws, payload, token) {
  // P12-02: no live connection until a required email is confirmed.
  if (gated(payload.sub)) {
    ws.close(4003, 'Confirm your email');
    return;
  }
  ws.token = token; // re-checked every gatewayAuth.reverifyMs (P11-13, L4)
  ws.userId = payload.sub;
  ws.tokenVersion = payload.ver || 0;
  ws.sid = payload.sid || null; // P9-03: which signed-in device
  ws.focus = null;
  ws.threadFocus = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  const set = userClients[ws.userId] || (userClients[ws.userId] = new Set());
  set.add(ws);
  if (set.size === 1) broadcastPresence(ws.userId); // their mode, or offline if invisible
  logInfo(`Gateway connected for user ${ws.userId} (${set.size} socket(s))`);

  ws.send(JSON.stringify({ type: 'ready' }));
  ws.send(JSON.stringify({
    type: 'unread',
    counts: db.getUnreadCounts(ws.userId),
    mentions: db.getMentionCounts(ws.userId),
    threads: db.getThreadFollows(ws.userId), // the threads you follow
  }));
  // Per conversation (P9-06a), with `with` (the other person) for pairs,
  // as the username-keyed app expects.
  const dmCounts = db.getDmUnreadCounts(ws.userId).map((c) => ({ conversation: c.conversation, with: c.other || null, count: c.count }));
  ws.send(JSON.stringify({ type: 'dm_unread', counts: dmCounts }));
  for (const frame of voiceStatesFor(ws.userId)) ws.send(JSON.stringify(frame));

  ws.on('message', (raw) => {
    // A bad frame must never take the whole server down.
    try {
      handleGatewayMessage(ws, raw);
    } catch (err) {
      console.error('[gateway] Error handling frame:', err);
    }
  });
  ws.on('close', () => detachGateway(ws));
  ws.on('error', () => detachGateway(ws));
}

module.exports = { attachGateway, sweepExpiredStatuses, sweepQuietThreads, gatewayAuth, reverifySockets };
