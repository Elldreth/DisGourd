const WebSocket = require('ws');
const db = require('../db');
const { canViewChannel } = require('../permissions');

// ---- Gateway routing ----
// The client holds a single "gateway" socket. Events are routed by membership:
// a message in a server is delivered to every online member's gateway, tagged
// with its space + channel so the client can place it (and, later, drive unread).

// Live gateway sockets, keyed by user id: { userId: Set<WebSocket> }.
const userClients = {};

function sendToUser(userId, frameStr) {
  const set = userClients[userId];
  if (!set) return;
  set.forEach((ws) => { if (ws.readyState === WebSocket.OPEN) ws.send(frameStr); });
}

// Close the user's sockets that signed in with an older token version (a
// password change, P6-02), telling them why first.
function endStaleSessions(userId, version, reason = 'password_changed') {
  const set = userClients[userId];
  if (!set) return;
  const frame = JSON.stringify({ type: 'signed_out', reason });
  for (const ws of [...set]) {
    if (ws.tokenVersion === version) continue;
    if (ws.readyState === WebSocket.OPEN) ws.send(frame);
    ws.close(4001, 'Signed out');
  }
}

// One device was signed out from the devices list (P9-03): close its sockets.
function endSession(userId, sid) {
  const set = userClients[userId];
  if (!set) return;
  const frame = JSON.stringify({ type: 'signed_out', reason: 'device' });
  for (const ws of [...set]) {
    if (ws.sid !== sid) continue;
    if (ws.readyState === WebSocket.OPEN) ws.send(frame);
    ws.close(4001, 'Signed out');
  }
}

function deliverToSpaceMembers(spaceName, frameStr) {
  const space = db.getSpaceByName(spaceName);
  if (!space) return;
  for (const m of db.getSpaceMembers(space.id)) sendToUser(m.userId, frameStr);
}

// Deliver a channel-scoped frame only to members allowed to view that channel.
function deliverToChannelViewers(spaceName, channelName, frameStr) {
  const space = db.getSpaceByName(spaceName);
  if (!space) return;
  for (const m of db.getSpaceMembers(space.id)) {
    if (canViewChannel(spaceName, channelName, m.userId)) sendToUser(m.userId, frameStr);
  }
}

// What others see: 'offline' when the user isn't connected or chose to be
// invisible, otherwise their chosen mode ('online' | 'idle' | 'dnd').
function effectiveStatus(userId) {
  if (!(userClients[userId] && userClients[userId].size > 0)) return 'offline';
  const mode = db.getUserPresence(userId);
  return mode === 'invisible' ? 'offline' : mode;
}

// What others see of a user: their effective status, plus their custom status
// text/emoji only while they appear online (hidden when invisible or away).
function publicPresence(userId) {
  const status = effectiveStatus(userId);
  const custom = status === 'offline' ? { statusText: null, statusEmoji: null } : db.getUserStatus(userId);
  return { status, statusText: custom.statusText, statusEmoji: custom.statusEmoji };
}

// Announce a user's current status to everyone who shares a server (or
// friendship) with them, so member lists update live. Never reveals the
// chosen mode itself (an invisible user just looks offline).
function broadcastPresence(userId) {
  const user = db.getUserById(userId);
  if (!user) return;
  const frame = JSON.stringify({ type: 'presence', user: user.username, userId, ...publicPresence(userId) });
  const targets = new Set(db.getCoMemberIds(userId));
  for (const f of db.getFriends(userId)) targets.add(f.id);
  targets.forEach((id) => sendToUser(id, frame));
}

// Tell a user they now follow (or no longer follow) a thread (P2-22c).
function tellFollow(userId, space, thread, followed) {
  sendToUser(userId, JSON.stringify({
    type: 'thread_follow', space, channel: thread.channel, parentChannel: thread.parentChannel, name: thread.name, followed,
  }));
}

module.exports = { userClients, sendToUser, endStaleSessions, endSession, deliverToSpaceMembers, deliverToChannelViewers, broadcastPresence, effectiveStatus, publicPresence, tellFollow };
