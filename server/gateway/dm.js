// Gateway ops for direct messages.
const WebSocket = require('ws');
const db = require('../db');
const push = require('../push');
const { MAX_MESSAGE_LENGTH, normalizeAttachments } = require('../validate');
const { userClients, sendToUser } = require('./delivery');
const { rejectFrame, TOO_LONG } = require('./frames');
const linkPreviews = require('../linkPreviews');

// Cards for the links in a DM, sent to both people in it.
function previewDm(dm, content, userId, edited = false) {
  linkPreviews.handleMessage({
    kind: 'dm', messageId: dm.id, content, userId, edited,
    deliver: (embeds) => {
      const frame = JSON.stringify({ type: 'dm_embeds', id: dm.id, embeds });
      sendToUser(dm.a, frame);
      sendToUser(dm.b, frame);
    },
  });
}

// Op handlers, called by router.js with { ws, msg, userId }.
const ops = {
  dm({ ws, msg, userId }) {
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
    // A reply quotes a message from this same conversation; anything else is ignored.
    const replyId = parseInt(msg.replyTo, 10);
    const replyTo = replyId > 0 ? db.getDmReplyTarget(userId, to.id, replyId) : null;
    const stored = db.storeDm(userId, to.id, content, attachments, spoiler, replyTo ? replyTo.id : null);
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
      replyTo,
      timestamp: stored.timestamp,
    });
    sendToUser(userId, frame);
    sendToUser(to.id, frame);
    if (content) previewDm({ id: stored.id, a: userId, b: to.id }, content, userId);
    // A DM to someone with no tab open gets a push (P2-18b).
    const sender = db.getUserById(userId);
    const senderName = sender ? sender.username : String(userId);
    push.notifyIfAway(to.id, { title: senderName, body: push.preview(content, attachments), data: { dm: senderName } }).catch(() => {});
    return;
  },
  dm_edit({ ws, msg, userId }) {
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
      previewDm({ id, a: dm.user_a, b: dm.user_b }, newContent, userId, true);
    }
    return;
  },
  dm_delete({ msg, userId }) {
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
  },
  dm_focus({ ws, msg }) {
    ws.dmFocus = typeof msg.with === 'string' ? msg.with : null;
    return;
  },
  dm_read({ msg, userId }) {
    const other = db.getUserByUsername(msg.with);
    if (other) db.markDmRead(userId, other.id, parseInt(msg.lastId, 10) || 0);
    return;
  },
  dm_typing({ msg, userId }) {
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
  },
};

module.exports = { ops };
