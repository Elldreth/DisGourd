// Gateway ops for server channels: focus, read state, messages, edits, deletes,
// reactions and typing.
const WebSocket = require('ws');
const db = require('../db');
const { MAX_MESSAGE_LENGTH, parseMentionUsernames, normalizeAttachments, parseReactionEmoji, parseCustomReaction } = require('../validate');
const { canViewChannel, canPostChannel, canView, canModerateMessage } = require('../permissions');
const { userClients, deliverToChannelViewers, tellFollow } = require('./delivery');
const { rejectFrame, TOO_LONG } = require('./frames');
const linkPreviews = require('../linkPreviews');

// A thread's reply count changed: refresh the summary under its root message
// for the parent channel's viewers.
function threadUpdated(space, channel) {
  if (!db.isThreadChannel(channel)) return;
  const thread = db.getThread(space, channel);
  if (!thread) return;
  deliverToChannelViewers(space, thread.parentChannel, JSON.stringify({
    type: 'thread_updated', space, channel: thread.parentChannel, rootMessageId: thread.rootMessageId, thread,
  }));
}

// Cards for the links in a channel message, sent to whoever can see it.
function previewChannelMessage(space, channel, id, content, userId, edited = false) {
  linkPreviews.handleMessage({
    kind: 'channel', messageId: id, content, userId, edited,
    deliver: (embeds) => deliverToChannelViewers(space, channel, JSON.stringify({ type: 'message_embeds', id, space, channel, embeds })),
  });
}

// Op handlers, called by router.js with { ws, msg, userId }.
const ops = {
  // Where this socket is looking (for typing indicators): the open channel,
  // and separately the thread open in the panel (`thread: true`). No
  // channel clears that focus.
  focus({ ws, msg }) {
    const at = typeof msg.space === 'string' && typeof msg.channel === 'string' ? { space: msg.space, channel: msg.channel } : null;
    if (msg.thread) ws.threadFocus = at;
    else ws.focus = at;
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
    const type = space ? db.channelType(msg.space, msg.channel) : null;
    if (!space || !db.isMember(space.id, userId) || (type !== 'text' && type !== 'thread')) return;
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
    // In a thread, the frame says which one (for notifications and badges).
    const thread = type === 'thread' ? db.getThread(msg.space, msg.channel) : null;
    const stored = db.storeMessageWithMentions(
      msg.space, msg.channel, content, userId, attachments, spoiler, space.id, mentionNames, replyTo ? replyTo.id : null
    );
    const mentions = stored ? stored.mentions : [];
    if (stored && thread) for (const uid of stored.newFollows) tellFollow(uid, msg.space, thread, true);
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
      thread: thread ? { name: thread.name, parentChannel: thread.parentChannel } : undefined,
    }));
    if (stored && content) previewChannelMessage(msg.space, msg.channel, stored.id, content, userId);
    if (stored) threadUpdated(msg.space, msg.channel);
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
      threadUpdated(loc.space, loc.channel);
    }
    return;
  },
  // Pin / unpin a channel message (needs the server's pin_messages permission
  // and access to the channel). Viewers are told with `message_pinned`.
  pin({ ws, msg, userId }) {
    return setPinned(ws, msg, userId, true);
  },
  unpin({ ws, msg, userId }) {
    return setPinned(ws, msg, userId, false);
  },
  react({ msg, userId }) {
    const id = parseInt(msg.id, 10);
    const emoji = parseReactionEmoji(msg.emoji);
    if (!id || !emoji) return;
    const loc = db.getMessageLocation(id);
    if (!loc || !canView(loc.space, loc.channel, userId)) return;
    // A custom emoji must belong to this message's server, under that name.
    const custom = parseCustomReaction(emoji);
    if (custom && !db.spaceHasEmoji(loc.space, custom.id, custom.name)) return;
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
    // Relay only to members currently viewing this channel, in the channel
    // itself or in the thread panel (excluding sender).
    const looking = (f) => !!f && f.space === msg.space && f.channel === msg.channel;
    for (const m of db.getSpaceMembers(space.id)) {
      if (!canViewChannel(msg.space, msg.channel, m.role)) continue;
      const socks = userClients[m.userId];
      if (!socks) continue;
      socks.forEach((s) => {
        if (s !== ws && s.readyState === WebSocket.OPEN && (looking(s.focus) || looking(s.threadFocus))) {
          s.send(frame);
        }
      });
    }
    return;
  },
};

function setPinned(ws, msg, userId, pinned) {
  const id = parseInt(msg.id, 10);
  if (!id) return;
  const loc = db.getMessageLocation(id);
  if (!loc || !canView(loc.space, loc.channel, userId)) return;
  const space = db.getSpaceByName(loc.space);
  const op = pinned ? 'pin' : 'unpin';
  if (!db.canDo(space.id, db.getMemberRole(space.id, userId), 'pin_messages')) {
    return rejectFrame(ws, op, "You don't have permission to pin messages here");
  }
  if (pinned) {
    const result = db.pinMessage(id, userId);
    if (result === 'full') return rejectFrame(ws, op, `This channel already has ${db.MAX_PINS_PER_CHANNEL} pinned messages`);
    if (result !== 'pinned') return;
  } else if (!db.unpinMessage(id)) {
    return;
  }
  const by = db.getUserById(userId);
  deliverToChannelViewers(loc.space, loc.channel, JSON.stringify({
    type: 'message_pinned', id, space: loc.space, channel: loc.channel, pinned, pinnedBy: by ? by.username : null,
  }));
}

module.exports = { ops, threadUpdated };
