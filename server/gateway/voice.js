// Gateway ops for voice channels (mesh WebRTC signaling relay).
const WebSocket = require('ws');
const db = require('../db');
const { canViewChannel } = require('../permissions');
const { deliverToChannelViewers } = require('./delivery');

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

// Who is in each voice room this user can see, as voice_state frames. Sent on
// connect, so a (re)connecting client doesn't show stale or empty rooms.
function voiceStatesFor(userId) {
  const frames = [];
  for (const room of voiceRooms.values()) {
    if (room.members.size === 0) continue;
    const space = db.getSpaceByName(room.space);
    if (!space || !db.isMember(space.id, userId)) continue;
    if (!canViewChannel(room.space, room.channel, db.getMemberRole(space.id, userId))) continue;
    frames.push({ type: 'voice_state', space: room.space, channel: room.channel, participants: voiceParticipants(room) });
  }
  return frames;
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

// Op handlers, called by router.js with { ws, msg, userId }.
const ops = {
  voice_join({ ws, msg, userId }) {
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
    // Rejoining from a new socket (a reconnect) before we noticed the old one
    // died: tell the others to drop their stale link to us first.
    const stale = room.members.get(userId);
    if (stale && stale.ws !== ws) {
      stale.ws.voiceRoom = null;
      room.members.delete(userId);
      for (const p of room.members.values()) {
        if (p.ws.readyState === WebSocket.OPEN) {
          p.ws.send(JSON.stringify({ type: 'voice_peer_left', space: room.space, channel: room.channel, userId }));
        }
      }
    }
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
  },
  voice_leave({ ws }) {
    voiceLeave(ws);
    return;
  },
  voice_signal({ ws, msg, userId }) {
    const room = voiceRooms.get(ws.voiceRoom);
    if (!room) return;
    const target = room.members.get(parseInt(msg.to, 10));
    if (target && target.ws.readyState === WebSocket.OPEN) {
      target.ws.send(JSON.stringify({ type: 'voice_signal', from: userId, data: msg.data }));
    }
    return;
  },
  voice_mute({ ws, msg, userId }) {
    const room = voiceRooms.get(ws.voiceRoom);
    if (!room) return;
    const entry = room.members.get(userId);
    if (entry) {
      entry.muted = !!msg.muted;
      broadcastVoiceState(room);
    }
    return;
  },
  voice_share({ ws, msg, userId }) {
    const room = voiceRooms.get(ws.voiceRoom);
    if (!room) return;
    const entry = room.members.get(userId);
    if (entry) {
      entry.sharing = !!msg.sharing;
      broadcastVoiceState(room);
    }
    return;
  },
};

module.exports = { ops, voiceLeave, voiceStatesFor };
