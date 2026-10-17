// Gateway ops for server channels: focus, read state, messages, edits, deletes,
// reactions and typing.
const WebSocket = require('ws');
const db = require('../db');
const { MAX_MESSAGE_LENGTH, parseMentionUsernames, normalizeAttachments, parseReactionEmoji } = require('../validate');
const { canViewChannel, canPostChannel, canView, canModerateMessage } = require('../permissions');
const { userClients, deliverToChannelViewers } = require('./delivery');
const { rejectFrame, TOO_LONG } = require('./frames');
const linkPreviews = require('../linkPreviews');

// Cards for the links in a channel message, sent to whoever can see it.
function previewChannelMessage(space, channel, id, content, userId, edited = false) {
  linkPreviews.handleMessage({
    kind: 'channel', messageId: id, content, userId, edited,
    deliver: (embeds) => deliverToChannelViewers(space, channel, JSON.stringify({ type: 'message_embeds', id, space, channel, embeds })),
  });
}

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
    // A reply quotes a message from this same channel; anything else is ignored.
    const replyId = parseInt(msg.replyTo, 10);
    const replyTo = replyId > 0 ? db.getReplyTarget(msg.space, msg.channel, replyId) : null;
    // Message, the author's read marker and mentions are written in one
    // transaction. Replying mentions the original's author (unless it's you).
    const mentionNames = content ? parseMentionUsernames(content) : [];
    if (replyTo && replyTo.authorId && replyTo.authorId !== userId && !mentionNames.includes(replyTo.author)) {
      mentionNames.push(replyTo.author);
    }
    const stored = db.storeMessageWithMentions(
      msg.space, msg.channel, content, userId, attachments, spoiler, space.id, mentionNames, replyTo ? replyTo.id : null
    );
    const mentions = stored ? stored.mentions : [];
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
      replyTo,
      timestamp: stored ? stored.timestamp : Date.now(),
    }));
    if (stored && content) previewChannelMessage(msg.space, msg.channel, stored.id, content, userId);
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
      previewChannelMessage(loc.space, loc.channel, id, newContent, userId, true);
    }
    return;
  },
  delete({ msg, userId }) {
    const id = parseInt(msg.id, 10);
    if (!id) return;
    const loc = db.getMessageLocation(id);
    if (!loc) return;
    // Authors delete their own; moderators delete others' within their rank.
    const deleted = Number(loc.authorId) === Number(userId)
      ? db.deleteMessage(id, userId)
      : canModerateMessage(loc.space, loc.channel, userId, loc.authorId) && db.deleteMessageById(id);
    if (deleted) {
      deliverToChannelViewers(loc.space, loc.channel, JSON.stringify({
        type: 'message_delete', id, space: loc.space, channel: loc.channel,
      }));
    }
    return;
  },
  react({ msg, userId }) {
    const id = parseInt(msg.id, 10);
    const emoji = parseReactionEmoji(msg.emoji);
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
