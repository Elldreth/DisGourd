const http = require('http');
const WebSocket = require('ws');
const url = require('url');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ quiet: true });
const db = require('./db');
const { config, registrationMode, isWeakSecret, resolveJwtSecret } = require('./config');
const { verifyToken } = require('./auth/tokens');
const { clientIp } = require('./auth/rateLimit');
const { isPlainObject, MAX_WS_PAYLOAD_BYTES } = require('./http/util');
const { MAX_MESSAGE_LENGTH, parseMentionUsernames, normalizeAttachments } = require('./validate');
const { canViewChannel, canPostChannel, canView } = require('./permissions');
const { userClients, sendToUser, deliverToChannelViewers, broadcastPresence } = require('./gateway/delivery');
const { handleHttp, handleHttpError } = require('./http/handler');
const { WEB_DIST } = require('./static');

// Per-connection lifecycle chatter is silenced under test to keep output clean
// and to avoid "log after teardown" noise; warnings and errors still print.
const isTest = process.env.NODE_ENV === 'test';
function logInfo(...args) { if (!isTest) console.log(...args); }

// Create HTTP server
const httpServer = http.createServer((req, res) => {
  handleHttp(req, res).catch((err) => handleHttpError(res, err));
});

// Create WebSocket server and attach it to the HTTP server
// noServer: the HTTP server above performs the handshake. maxPayload replaces
// ws's 100 MiB default; oversized frames close the socket (code 1009).
const wss = new WebSocket.Server({ noServer: true, maxPayload: MAX_WS_PAYLOAD_BYTES });

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

// ---- Voice rooms (mesh WebRTC signaling relay; no media touches the server) ----
// roomKey -> { space, channel, members: Map<userId, { ws, userId, username, avatar, muted }> }
const voiceRooms = new Map();
const voiceKey = (space, channel) => JSON.stringify([space, channel]);

function voiceParticipants(room) {
  return [...room.members.values()].map((p) => ({
    userId: p.userId, username: p.username, avatar: p.avatar, muted: p.muted, sharing: !!p.sharing,
  }));
}

// Tell every server member who is currently in this voice channel.
function broadcastVoiceState(room) {
  deliverToChannelViewers(room.space, room.channel, JSON.stringify({
    type: 'voice_state', space: room.space, channel: room.channel, participants: voiceParticipants(room),
  }));
}

function voiceLeave(ws) {
  const key = ws.voiceRoom;
  if (!key) return;
  ws.voiceRoom = null;
  const room = voiceRooms.get(key);
  if (!room) return;
  const entry = room.members.get(ws.userId);
  if (!entry || entry.ws !== ws) return;
  room.members.delete(ws.userId);
  for (const p of room.members.values()) {
    if (p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(JSON.stringify({ type: 'voice_peer_left', space: room.space, channel: room.channel, userId: ws.userId }));
    }
  }
  if (room.members.size === 0) voiceRooms.delete(key);
  broadcastVoiceState(room);
}

// Fields that are always strings when present; a frame carrying an object or
// number in one of them is malformed and dropped whole.
const GATEWAY_STRING_FIELDS = ['op', 'space', 'channel', 'with', 'content', 'emoji'];

// Tell the sender why a frame was refused (clients may ignore this).
function rejectFrame(ws, op, error) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'error', op, error }));
}
const TOO_LONG = `Messages can be at most ${MAX_MESSAGE_LENGTH} characters`;

function handleGatewayMessage(ws, raw) {
  let msg;
  try { msg = JSON.parse(raw.toString()); } catch { return; }
  if (!isPlainObject(msg)) return;
  for (const key of GATEWAY_STRING_FIELDS) {
    if (msg[key] !== undefined && typeof msg[key] !== 'string') return;
  }
  const userId = ws.userId;

  switch (msg.op) {
    case 'focus': {
      if (typeof msg.space === 'string' && typeof msg.channel === 'string') {
        ws.focus = { space: msg.space, channel: msg.channel };
      } else {
        ws.focus = null;
      }
      return;
    }
    case 'read': {
      if (typeof msg.space === 'string' && typeof msg.channel === 'string') {
        db.markRead(userId, msg.space, msg.channel, parseInt(msg.lastId, 10) || 0);
      }
      return;
    }
    case 'message': {
      const space = db.getSpaceByName(msg.space);
      if (!space || !db.isMember(space.id, userId) || db.channelType(msg.space, msg.channel) !== 'text') return;
      // Enforce channel view/post role gates.
      const mrole = db.getMemberRole(space.id, userId);
      if (!canViewChannel(msg.space, msg.channel, mrole) || !canPostChannel(msg.space, msg.channel, mrole)) return;
      const content = typeof msg.content === 'string' ? msg.content : '';
      if (content.length > MAX_MESSAGE_LENGTH) return rejectFrame(ws, msg.op, TOO_LONG);
      const attachments = normalizeAttachments(msg);
      if (!content && attachments.length === 0) return;
      const spoiler = !!msg.spoiler && attachments.length > 0;
      const user = db.getUserById(userId);
      const stored = db.storeMessage(msg.space, msg.channel, content, userId, attachments, spoiler);
      if (stored) db.markRead(userId, msg.space, msg.channel, stored.id); // author has read their own message
      let mentions = [];
      if (stored && content) {
        const names = parseMentionUsernames(content);
        if (names.length) mentions = db.addMentions(stored.id, space.id, names);
      }
      deliverToChannelViewers(msg.space, msg.channel, JSON.stringify({
        type: 'message',
        id: stored ? stored.id : undefined,
        space: msg.space,
        channel: msg.channel,
        author: user ? user.username : userId,
        authorId: userId,
        authorAvatar: user ? user.avatar_url || null : null,
        content,
        attachment: attachments[0], // first, for older clients
        attachments,
        spoiler,
        mentions,
        timestamp: stored ? stored.timestamp : Date.now(),
      }));
      return;
    }
    case 'edit': {
      const id = parseInt(msg.id, 10);
      const newContent = typeof msg.content === 'string' ? msg.content.trim() : '';
      if (!id || !newContent) return;
      if (newContent.length > MAX_MESSAGE_LENGTH) return rejectFrame(ws, msg.op, TOO_LONG);
      const loc = db.getMessageLocation(id);
      if (!loc || !canView(loc.space, loc.channel, userId)) return;
      const editedAt = db.editMessage(id, userId, newContent); // author-only in DB
      if (editedAt) {
        deliverToChannelViewers(loc.space, loc.channel, JSON.stringify({
          type: 'message_update', id, space: loc.space, channel: loc.channel, content: newContent, editedAt,
        }));
      }
      return;
    }
    case 'delete': {
      const id = parseInt(msg.id, 10);
      if (!id) return;
      const loc = db.getMessageLocation(id);
      if (!loc) return;
      if (db.deleteMessage(id, userId)) {
        deliverToChannelViewers(loc.space, loc.channel, JSON.stringify({
          type: 'message_delete', id, space: loc.space, channel: loc.channel,
        }));
      }
      return;
    }
    case 'react': {
      const id = parseInt(msg.id, 10);
      const emoji = typeof msg.emoji === 'string' ? msg.emoji.trim().slice(0, 16) : '';
      if (!id || !emoji) return;
      const loc = db.getMessageLocation(id);
      if (!loc || !canView(loc.space, loc.channel, userId)) return;
      db.toggleReaction(id, userId, emoji);
      const agg = db.getReaction(id, emoji);
      deliverToChannelViewers(loc.space, loc.channel, JSON.stringify({
        type: 'reaction', id, emoji, count: agg.count, users: agg.users, space: loc.space, channel: loc.channel,
      }));
      return;
    }
    case 'typing': {
      const space = db.getSpaceByName(msg.space);
      if (!space || !canView(msg.space, msg.channel, userId)) return;
      const user = db.getUserById(userId);
      const frame = JSON.stringify({
        type: 'typing', user: user ? user.username : String(userId), space: msg.space, channel: msg.channel,
      });
      // Relay only to members currently viewing this channel (excluding sender).
      for (const m of db.getSpaceMembers(space.id)) {
        if (!canViewChannel(msg.space, msg.channel, m.role)) continue;
        const socks = userClients[m.userId];
        if (!socks) continue;
        socks.forEach((s) => {
          if (s !== ws && s.readyState === WebSocket.OPEN && s.focus &&
              s.focus.space === msg.space && s.focus.channel === msg.channel) {
            s.send(frame);
          }
        });
      }
      return;
    }

    // ---- Direct messages ----
    case 'dm': {
      if (typeof msg.to !== 'string') return;
      const to = db.getUserByUsername(msg.to);
      if (!to || to.id === userId) return;
      const content = typeof msg.content === 'string' ? msg.content : '';
      if (content.length > MAX_MESSAGE_LENGTH) return rejectFrame(ws, msg.op, TOO_LONG);
      const attachments = normalizeAttachments(msg);
      if (!content && attachments.length === 0) return;
      const spoiler = !!msg.spoiler && attachments.length > 0;
      const from = db.getUserById(userId);
      if (!from) return;
      const stored = db.storeDm(userId, to.id, content, attachments, spoiler);
      db.markDmRead(userId, to.id, stored.id); // sender has read their own message
      const frame = JSON.stringify({
        type: 'dm',
        id: stored.id,
        from: from.username,
        fromId: userId,
        fromAvatar: from.avatar_url || null,
        to: to.username,
        toId: to.id,
        content,
        attachment: attachments[0],
        attachments,
        spoiler,
        timestamp: stored.timestamp,
      });
      sendToUser(userId, frame);
      sendToUser(to.id, frame);
      return;
    }
    case 'dm_edit': {
      const id = parseInt(msg.id, 10);
      const newContent = typeof msg.content === 'string' ? msg.content.trim() : '';
      if (!id || !newContent) return;
      if (newContent.length > MAX_MESSAGE_LENGTH) return rejectFrame(ws, msg.op, TOO_LONG);
      const dm = db.getDmById(id);
      if (!dm) return;
      const editedAt = db.editDm(id, userId, newContent); // author-only in DB
      if (editedAt) {
        const frame = JSON.stringify({ type: 'dm_update', id, content: newContent, editedAt });
        sendToUser(dm.user_a, frame);
        sendToUser(dm.user_b, frame);
      }
      return;
    }
    case 'dm_delete': {
      const id = parseInt(msg.id, 10);
      if (!id) return;
      const dm = db.getDmById(id);
      if (!dm) return;
      if (db.deleteDm(id, userId)) {
        const frame = JSON.stringify({ type: 'dm_delete', id });
        sendToUser(dm.user_a, frame);
        sendToUser(dm.user_b, frame);
      }
      return;
    }
    case 'dm_focus': {
      ws.dmFocus = typeof msg.with === 'string' ? msg.with : null;
      return;
    }
    case 'dm_read': {
      const other = db.getUserByUsername(msg.with);
      if (other) db.markDmRead(userId, other.id, parseInt(msg.lastId, 10) || 0);
      return;
    }
    case 'dm_typing': {
      const to = db.getUserByUsername(msg.with);
      if (!to) return;
      const from = db.getUserById(userId);
      if (!from) return;
      const frame = JSON.stringify({ type: 'dm_typing', from: from.username });
      const socks = userClients[to.id];
      if (socks) {
        socks.forEach((s) => {
          if (s.readyState === WebSocket.OPEN && s.dmFocus === from.username) s.send(frame);
        });
      }
      return;
    }

    // ---- Voice (mesh signaling) ----
    case 'voice_join': {
      const space = db.getSpaceByName(msg.space);
      if (!space || !db.isMember(space.id, userId) || db.channelType(msg.space, msg.channel) !== 'voice') return;
      if (!canViewChannel(msg.space, msg.channel, db.getMemberRole(space.id, userId))) return; // no access to this channel
      voiceLeave(ws); // only one voice channel at a time
      const key = voiceKey(msg.space, msg.channel);
      let room = voiceRooms.get(key);
      if (!room) {
        room = { space: msg.space, channel: msg.channel, members: new Map() };
        voiceRooms.set(key, room);
      }
      const user = db.getUserById(userId);
      if (!user) return;
      const existing = [...room.members.values()].map((p) => ({
        userId: p.userId, username: p.username, avatar: p.avatar, muted: p.muted,
      }));
      const me = { ws, userId, username: user.username, avatar: user.avatar_url || null, muted: false, sharing: false };
      room.members.set(userId, me);
      ws.voiceRoom = key;
      // The joiner initiates offers to everyone already here.
      ws.send(JSON.stringify({ type: 'voice_peers', space: msg.space, channel: msg.channel, peers: existing }));
      for (const p of room.members.values()) {
        if (p.userId !== userId && p.ws.readyState === WebSocket.OPEN) {
          p.ws.send(JSON.stringify({
            type: 'voice_peer_joined', space: msg.space, channel: msg.channel,
            peer: { userId, username: me.username, avatar: me.avatar, muted: false },
          }));
        }
      }
      broadcastVoiceState(room);
      return;
    }
    case 'voice_leave': {
      voiceLeave(ws);
      return;
    }
    case 'voice_signal': {
      const room = voiceRooms.get(ws.voiceRoom);
      if (!room) return;
      const target = room.members.get(parseInt(msg.to, 10));
      if (target && target.ws.readyState === WebSocket.OPEN) {
        target.ws.send(JSON.stringify({ type: 'voice_signal', from: userId, data: msg.data }));
      }
      return;
    }
    case 'voice_mute': {
      const room = voiceRooms.get(ws.voiceRoom);
      if (!room) return;
      const entry = room.members.get(userId);
      if (entry) {
        entry.muted = !!msg.muted;
        broadcastVoiceState(room);
      }
      return;
    }
    case 'voice_share': {
      const room = voiceRooms.get(ws.voiceRoom);
      if (!room) return;
      const entry = room.members.get(userId);
      if (entry) {
        entry.sharing = !!msg.sharing;
        broadcastVoiceState(room);
      }
      return;
    }
    default:
      return;
  }
}

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

if (require.main === module) {
  httpServer.listen(config.port, () => {
    const hasBuild = fs.existsSync(path.join(WEB_DIST, 'index.html'));
    console.log(`\n  DisGourd is running 🥒`);
    console.log(`  → Open http://localhost:${config.port} in your browser\n`);
    const reg = registrationMode();
    console.log(`  Registration: ${reg}${reg === 'code' ? ' (a code is required — manage them in Settings)' : ''}${config.maxAccounts ? ` · max ${config.maxAccounts} accounts` : ''}`);
    console.log('');
    if (!hasBuild) {
      console.log('  Note: the web client is not built yet. Run `npm run build` (or `npm run dev`');
      console.log('  for the hot-reloading dev server) to see the UI.\n');
    }
  });
}

module.exports = { httpServer, wss, config, db, isWeakSecret, resolveJwtSecret, clientIp };
