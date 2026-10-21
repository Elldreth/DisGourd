// Gateway ops for direct messages.
//
// P9-06a: a DM belongs to a conversation. Ops take `conversation` (its id),
// or, as before, the other person's username (`to` / `with`), which means
// their pair conversation. Frames carry `conversation` and go to everyone in
// it; pairs keep their username fields (from, to, toId) for the app.
//
// P9-06c: group DMs. Anyone in a group adds people (someone they share a
// server with, or a friend; 10 at most) and renames it; anyone leaves; the
// owner removes. Changes post a notice (kind 'system') and send everyone
// the group's summary (`dm_conversation`); someone leaving or removed gets
// `dm_left`.
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

const MAX_GROUP = 10;
// P9-07a: the same words for both sides, so it doesn't say who blocked whom.
const BLOCKED_DM = "You can't message this person";
const MAX_GROUP_NAME = 50;
// Refuse an op with a code the app can act on.
function refuse(ws, op, code, error) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'error', op, code, error }));
}
// "bob", "bob and cara", "bob, cara and dee"
function listNames(names) {
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
// A group's title for pushes: its name, or its members' names (not yours).
function groupTitle(conversationId, forUserId) {
  const conv = db.getConversation(conversationId);
  if (conv.name) return conv.name;
  return listNames(db.participantIds(conversationId).filter((id) => id !== forUserId).map((id) => db.getUserById(id)?.username).filter(Boolean));
}
// Each person's own summary (it holds their Mute) of the conversation.
function sendSummaries(conversationId, extra = {}) {
  for (const id of db.participantIds(conversationId)) {
    const summary = db.getConversationSummary(conversationId, id);
    if (summary) sendToUser(id, JSON.stringify({ type: 'dm_conversation', conversation: summary, ...extra }));
  }
}
// A notice in the conversation ("sandy added bob"), shown to everyone in it.
function notice(conversationId, actor, text) {
  const stored = db.storeConversationDm(conversationId, actor.id, text, [], false, null, 'system');
  sendToConversation(conversationId, JSON.stringify({
    type: 'dm', kind: 'system', id: stored.id, conversation: conversationId,
    from: actor.username, fromId: actor.id, fromAvatar: actor.avatar_url || null, to: null, toId: null,
    content: text, attachments: [], spoiler: false, replyTo: null, timestamp: stored.timestamp,
  }));
}
// The people to add, by username: [users] or a refusal { code, error }.
function peopleToAdd(adderId, names) {
  if (!Array.isArray(names) || names.some((n) => typeof n !== 'string')) return { code: 'BAD_REQUEST', error: 'Pick who to add' };
  const users = [];
  for (const name of [...new Set(names.map((n) => n.trim()).filter(Boolean))]) {
    const u = db.getUserByUsername(name);
    if (!u) return { code: 'NOT_FOUND', error: `There's no one called ${name}` };
    if (u.id === adderId) continue;
    if (!db.canAddToGroup(adderId, u.id)) return { code: 'NOT_ALLOWED', error: `You can only add people you share a server with or are friends with (not ${u.username})` };
    // P9-07a: either has blocked the other; it doesn't say which.
    if (db.eitherBlocked(adderId, u.id)) return { code: 'BLOCKED', error: `You can't add ${u.username}` };
    users.push(u);
  }
  return { users };
}
// A group this person is in, or null.
function groupFor(msg, userId) {
  const id = parseInt(msg.conversation, 10);
  if (!(id > 0) || !db.isParticipant(id, userId)) return null;
  const conv = db.getConversation(id);
  return conv && conv.kind === 'group' ? conv : null;
}
const cleanName = (name) => (typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '');

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
    // P9-07a: no DMs where either has blocked the other (checked before a new pair is made).
    if (typeof msg.to === 'string' && msg.conversation == null) {
      const to = db.getUserByUsername(msg.to);
      if (to && db.eitherBlocked(userId, to.id)) return refuse(ws, msg.op, 'BLOCKED', BLOCKED_DM);
    }
    const conversationId = conversationFor(msg, userId, { create: true });
    if (!conversationId) return;
    const conv = db.getConversation(conversationId);
    const partner = conv.kind === 'pair' ? db.pairPartner(conversationId, userId) : null;
    if (conv.kind === 'pair' && !partner) return;
    if (partner && db.eitherBlocked(userId, partner.id)) return refuse(ws, msg.op, 'BLOCKED', BLOCKED_DM);
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
    // A group's says which group: "Gourd Club" / "sandy: …".
    for (const p of db.participantsOf(conversationId)) {
      if (p.userId === userId || p.muted || db.isBlocked(p.userId, userId)) continue; // P9-07a: not from someone they blocked
      const group = conv.kind === 'group';
      const body = push.preview(content, attachments);
      push.notifyIfAway(p.userId, {
        title: group ? groupTitle(conversationId, p.userId) : from.username,
        body: group ? `${from.username}: ${body}` : body,
        data: { dm: from.username, conversation: conversationId },
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
  // ---- Groups (P9-06c) ----
  dm_group_create({ ws, msg, userId }) {
    const me = db.getUserById(userId);
    if (!me) return;
    const picked = peopleToAdd(userId, msg.members);
    if (picked.error) return refuse(ws, msg.op, picked.code, picked.error);
    if (picked.users.length < 2) return refuse(ws, msg.op, 'BAD_REQUEST', 'A group needs at least two other people');
    if (picked.users.length + 1 > MAX_GROUP) return refuse(ws, msg.op, 'TOO_MANY', `A group can have at most ${MAX_GROUP} people`);
    const name = cleanName(msg.name);
    if (name.length > MAX_GROUP_NAME) return refuse(ws, msg.op, 'BAD_REQUEST', `Group names are at most ${MAX_GROUP_NAME} characters`);
    const id = db.createGroup(userId, picked.users.map((u) => u.id), name);
    notice(id, me, `${me.username} started the group`);
    sendSummaries(id);
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'dm_group_created', conversation: id }));
  },
  dm_group_add({ ws, msg, userId }) {
    const conv = groupFor(msg, userId);
    if (!conv) return refuse(ws, msg.op, 'NOT_FOUND', 'That group isn’t here');
    const me = db.getUserById(userId);
    const picked = peopleToAdd(userId, msg.members);
    if (picked.error) return refuse(ws, msg.op, picked.code, picked.error);
    const now = new Set(db.participantIds(conv.id));
    const added = picked.users.filter((u) => !now.has(u.id));
    if (!added.length) return refuse(ws, msg.op, 'BAD_REQUEST', 'They’re already in the group');
    if (now.size + added.length > MAX_GROUP) return refuse(ws, msg.op, 'TOO_MANY', `A group can have at most ${MAX_GROUP} people`);
    db.addParticipants(conv.id, added.map((u) => u.id));
    notice(conv.id, me, `${me.username} added ${listNames(added.map((u) => u.username))}`);
    sendSummaries(conv.id);
  },
  dm_group_remove({ ws, msg, userId }) {
    const conv = groupFor(msg, userId);
    if (!conv) return refuse(ws, msg.op, 'NOT_FOUND', 'That group isn’t here');
    if (conv.ownerId !== userId) return refuse(ws, msg.op, 'NOT_ALLOWED', 'Only the group’s owner can remove people');
    const who = typeof msg.member === 'string' ? db.getUserByUsername(msg.member) : null;
    if (!who || who.id === userId || !db.isParticipant(conv.id, who.id)) return refuse(ws, msg.op, 'NOT_FOUND', 'They aren’t in the group');
    const me = db.getUserById(userId);
    notice(conv.id, me, `${me.username} removed ${who.username}`);
    db.leaveConversation(conv.id, who.id);
    sendToUser(who.id, JSON.stringify({ type: 'dm_left', conversation: conv.id, reason: 'removed', name: conv.name || null }));
    sendSummaries(conv.id);
  },
  dm_group_leave({ ws, msg, userId }) {
    const conv = groupFor(msg, userId);
    if (!conv) return refuse(ws, msg.op, 'NOT_FOUND', 'That group isn’t here');
    const me = db.getUserById(userId);
    notice(conv.id, me, `${me.username} left`);
    const after = db.leaveConversation(conv.id, userId);
    sendToUser(userId, JSON.stringify({ type: 'dm_left', conversation: conv.id, reason: 'left', name: conv.name || null }));
    if (after.gone) return;
    if (after.newOwner) {
      const owner = db.getUserById(after.newOwner);
      if (owner) notice(conv.id, owner, `${owner.username} is now the owner`);
    }
    sendSummaries(conv.id);
  },
  dm_group_rename({ ws, msg, userId }) {
    const conv = groupFor(msg, userId);
    if (!conv) return refuse(ws, msg.op, 'NOT_FOUND', 'That group isn’t here');
    const name = cleanName(msg.name);
    if (name.length > MAX_GROUP_NAME) return refuse(ws, msg.op, 'BAD_REQUEST', `Group names are at most ${MAX_GROUP_NAME} characters`);
    if ((conv.name || '') === name) return;
    const me = db.getUserById(userId);
    db.renameConversation(conv.id, name);
    notice(conv.id, me, name ? `${me.username} named the group ${name}` : `${me.username} removed the group’s name`);
    sendSummaries(conv.id);
  },
  // Mute (any conversation): unread still counts; no pushes or sounds.
  dm_mute({ ws, msg, userId }) {
    const id = parseInt(msg.conversation, 10);
    if (!(id > 0) || !db.isParticipant(id, userId)) return refuse(ws, msg.op, 'NOT_FOUND', 'That conversation isn’t here');
    db.setConversationMuted(id, userId, !!msg.muted);
    const summary = db.getConversationSummary(id, userId);
    if (summary) sendToUser(userId, JSON.stringify({ type: 'dm_conversation', conversation: summary }));
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
      if (db.isBlocked(id, userId)) continue; // P9-07a: no typing from someone they blocked
      for (const s of userClients[id] || []) {
        const looking = (conversationId && s.dmConversation === conversationId) || (pair && s.dmFocus === from.username);
        if (s.readyState === WebSocket.OPEN && looking) s.send(frame);
      }
    }
    return;
  },
};

module.exports = { ops, sendToConversation };
