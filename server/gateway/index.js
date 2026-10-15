const url = require('url');
const db = require('../db');
const { verifyToken } = require('../auth/tokens');
const { userClients, broadcastPresence } = require('./delivery');
const { voiceLeave } = require('./voice');
const { handleGatewayMessage } = require('./router');

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
    broadcastPresence(ws.userId, 'offline');
  }
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
  wss.on('close', () => clearInterval(heartbeatTimer));

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

    wss.handleUpgrade(request, socket, head, (ws) => {
      ws.userId = payload.sub;
      ws.focus = null;
      ws.isAlive = true;
      ws.on('pong', () => { ws.isAlive = true; });

      const set = userClients[ws.userId] || (userClients[ws.userId] = new Set());
      set.add(ws);
      if (set.size === 1) broadcastPresence(ws.userId, 'online');
      logInfo(`Gateway connected for user ${ws.userId} (${set.size} socket(s))`);

      ws.send(JSON.stringify({ type: 'ready' }));
      ws.send(JSON.stringify({ type: 'unread', counts: db.getUnreadCounts(ws.userId), mentions: db.getMentionCounts(ws.userId) }));
      // Keyed by `with`, like the other DM ops (getDmUnreadCounts names it `other`).
      const dmCounts = db.getDmUnreadCounts(ws.userId).map((c) => ({ with: c.other, count: c.count }));
      ws.send(JSON.stringify({ type: 'dm_unread', counts: dmCounts }));

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

module.exports = { attachGateway };
