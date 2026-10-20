// Gateway ops for direct messages.
//
// P9-06a: a DM belongs to a conversation. Ops take `conversation` (its id),
// or, as before, the other person's username (`to` / `with`), which means
// their pair conversation. Frames carry `conversation` and go to everyone in
// it; pairs keep their username fields (from, to, toId) for the app.
const WebSocket = require('ws');
const db = require('../db');
const push = require('../push');
const { MAX_MESSAGE_LENGTH, normalizeAttachments } = require('../validate');
const { userClients, sendToUser } = require('./delivery');
const { rejectFrame, TOO_LONG } = require('./frames');
const linkPreviews = require('../linkPreviews');

// Everyone in a conversation gets the frame.
function sendToConversation(conversationId, frame) {
  for (const id of db.participantIds(conversationId)) sendToUser(id, frame);
}

// The conversation an op means, if this person is in it: `conversation`, or
// the pair with the username in `to` / `with` (made on a first message when
// `create`). Null otherwise.
function conversationFor(msg, userId, { create = false } = {}) {
  if (msg.conversation != null) {
    const id = parseInt(msg.conversation, 10);
    return id > 0 && db.isParticipant(id, userId) ? id : null;
  }
  const name = typeof msg.to === 'string' ? msg.to : typeof msg.with === 'string' ? msg.with : null;
  if (!name) return null;
  const other = db.getUserByUsername(name);
  if (!other || other.id === userId) return null;
  return create ? db.getOrCreatePair(userId, other.id) : db.findPair(userId, other.id);
}

// Cards for the links in a DM, sent to everyone in its conversation.
function previewDm(id, conversationId, content, userId, edited = false) {
  linkPreviews.handleMessage({
    kind: 'dm', messageId: id, content, userId, edited,
    deliver: (embeds) => sendToConversation(conversationId, JSON.stringify({ type: 'dm_embeds', id, conversation: conversationId, embeds })),
  });
}

// Op handlers, called by router.js with { ws, msg, userId }.
const ops = {
  dm({ ws, msg, userId }) {
    if (typeof msg.to !== 'string' && msg.conversation == null) return;
    const content = typeof msg.content === 'string' ? msg.content : '';
    if (content.length > MAX_MESSAGE_LENGTH) return rejectFrame(ws, msg.op, TOO_LONG);
    const attachments = normalizeAttachments(msg);
    if (!content && attachments.length === 0) return;
    const from = db.getUserById(userId);
    if (!from) return;
    const conversationId = conversationFor(msg, userId, { create: true });
    if (!conversationId) return;
    const conv = db.getConversation(conversationId);
    const partner = conv.kind === 'pair' ? db.pairPartner(conversationId, userId) : null;
    if (conv.kind === 'pair' && !partner) return;
    const spoiler = !!msg.spoiler && attachments.length > 0;
    // A reply quotes a message from this same conversation; anything else is ignored.
    const replyId = parseInt(msg.replyTo, 10);
    const replyTo = replyId > 0 ? db.getConversationReplyTarget(conversationId, replyId) : null;
    const stored = db.storeConversationDm(conversationId, userId, content, attachments, spoiler, replyTo ? replyTo.id : null);
    db.markConversationRead(userId, conversationId, stored.id); // sender has read their own message
    const frame = JSON.stringify({
      type: 'dm',
      id: stored.id,
      conversation: conversationId,
      from: from.username,
      fromId: userId,
      fromAvatar: from.avatar_url || null,
      to: partner ? partner.username : null,
      toId: partner ? partner.id : null,
      content,
      attachment: attachments[0],
      attachments,
      spoiler,
      replyTo,
      timestamp: stored.timestamp,
    });
    sendToConversation(conversationId, frame);
    if (content) previewDm(stored.id, conversationId, content, userId);
    // Everyone else with no tab open gets a push (P2-18b), unless they muted it.
    for (const p of db.participantsOf(conversationId)) {
      if (p.userId === userId || p.muted) continue;
      push.notifyIfAway(p.userId, {
        title: from.username, body: push.preview(content, attachments), data: { dm: from.username, conversation: conversationId },
      }).catch(() => {});
    }
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
      sendToConversation(dm.conversationId, JSON.stringify({ type: 'dm_update', id, conversation: dm.conversationId, content: newContent, editedAt }));
      previewDm(id, dm.conversationId, newContent, userId, true);
    }
    return;
  },
  dm_delete({ msg, userId }) {
    const id = parseInt(msg.id, 10);
    if (!id) return;
    const dm = db.getDmById(id);
    if (!dm) return;
    // Its people first: once it's gone, the conversation is all we have.
    if (db.deleteDm(id, userId)) sendToConversation(dm.conversationId, JSON.stringify({ type: 'dm_delete', id, conversation: dm.conversationId }));
    return;
  },
  // What this tab is looking at, for typing: the conversation, and (the
  // username-keyed app) the other person's username.
  dm_focus({ ws, msg, userId }) {
    ws.dmFocus = typeof msg.with === 'string' ? msg.with : null;
    ws.dmConversation = msg.conversation != null || ws.dmFocus ? conversationFor(msg, userId) : null;
    return;
  },
  dm_read({ msg, userId }) {
    const conversationId = conversationFor(msg, userId);
    if (conversationId) db.markConversationRead(userId, conversationId, parseInt(msg.lastId, 10) || 0);
    return;
  },
  // Typing goes to the others' tabs looking at this conversation. A pair not
  // yet started (no messages) has no conversation: its tabs match by name.
  dm_typing({ msg, userId }) {
    const from = db.getUserById(userId);
    if (!from) return;
    const conversationId = conversationFor(msg, userId);
    let targets;
    let pair = true;
    if (conversationId) {
      targets = db.participantIds(conversationId).filter((id) => id !== userId);
      pair = db.getConversation(conversationId).kind === 'pair';
    } else {
      const to = typeof msg.with === 'string' ? db.getUserByUsername(msg.with) : null;
      if (!to || to.id === userId) return;
      targets = [to.id];
    }
    const frame = JSON.stringify({ type: 'dm_typing', from: from.username, conversation: conversationId });
    for (const id of targets) {
      for (const s of userClients[id] || []) {
        const looking = (conversationId && s.dmConversation === conversationId) || (pair && s.dmFocus === from.username);
        if (s.readyState === WebSocket.OPEN && looking) s.send(frame);
      }
    }
    return;
  },
};

module.exports = { ops, sendToConversation };
