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
    if (canViewChannel(spaceName, channelName, m.role)) sendToUser(m.userId, frameStr);
  }
}

// Announce a user's online/offline transition to everyone who shares a server
// (or friendship) with them, so member lists update live.
function broadcastPresence(userId, status) {
  const user = db.getUserById(userId);
  if (!user) return;
  const frame = JSON.stringify({ type: 'presence', user: user.username, userId, status });
  const targets = new Set(db.getCoMemberIds(userId));
  for (const f of db.getFriends(userId)) targets.add(f.id);
  targets.forEach((id) => sendToUser(id, frame));
}

module.exports = { userClients, sendToUser, deliverToSpaceMembers, deliverToChannelViewers, broadcastPresence };
