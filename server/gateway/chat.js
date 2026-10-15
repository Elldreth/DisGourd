// Gateway ops for server channels: focus, read state, messages, edits, deletes,
// reactions and typing.
const WebSocket = require('ws');
const db = require('../db');
const { MAX_MESSAGE_LENGTH, parseMentionUsernames, normalizeAttachments } = require('../validate');
const { canViewChannel, canPostChannel, canView } = require('../permissions');
const { userClients, deliverToChannelViewers } = require('./delivery');
const { rejectFrame, TOO_LONG } = require('./frames');

// Op handlers, called by router.js with { ws, msg, userId }.
const ops = {
  focus({ ws, msg }) {
    if (typeof msg.space === 'string' && typeof msg.channel === 'string') {
      ws.focus = { space: msg.space, channel: msg.channel };
    } else {
      ws.focus = null;
    }
    return;
  },
  read({ msg, userId }) {
    if (typeof msg.space === 'string' && typeof msg.channel === 'string') {
      db.markRead(userId, msg.space, msg.channel, parseInt(msg.lastId, 10) || 0);
    }
    return;
  },
  message({ ws, msg, userId }) {
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
  },
  edit({ ws, msg, userId }) {
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
  },
  delete({ msg, userId }) {
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
  },
  react({ msg, userId }) {
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
  },
  typing({ ws, msg, userId }) {
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
  },
};

module.exports = { ops };
