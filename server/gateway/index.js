const url = require('url');
const db = require('../db');
const { verifyToken } = require('../auth/tokens');
const { userClients, broadcastPresence, sendToUser } = require('./delivery');
const { voiceLeave, voiceStatesFor } = require('./voice');
const { handleGatewayMessage } = require('./router');
const { threadUpdated } = require('./chat');
const { config } = require('../config');
const { tooManySockets } = require('./limits');

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
  wss.on('close', () => {
    clearInterval(heartbeatTimer);
    clearInterval(statusTimer);
    clearInterval(threadTimer);
  });

  httpServer.on('upgrade', (request, socket, head) => {
    const parsedUrl = url.parse(request.url, true);
    if (parsedUrl.pathname !== '/gateway') {
      socket.destroy();
      return;
    }
    const token = parsedUrl.query && parsedUrl.query.token;
    const payload = token ? verifyToken(token) : null;
    if (!payload) {
      socket.destroy();
      return;
    }
    // P11-03: at most MAX_SOCKETS_PER_USER open sockets each; the newest is refused.
    const open = userClients[payload.sub] ? userClients[payload.sub].size : 0;
    if (tooManySockets(open)) {
      socket.end('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
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
    });
  });
}

module.exports = { attachGateway, sweepExpiredStatuses, sweepQuietThreads };
