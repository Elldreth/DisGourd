const db = require('./db');

// Per-channel role gates. Unknown channels return true so normal 404 handling
// applies elsewhere.
function canViewChannel(spaceName, channelName, role) {
  const cp = db.getChannelPerms(spaceName, channelName);
  return !cp || db.roleRank(role) >= (cp.view || 1);
}
function canPostChannel(spaceName, channelName, role) {
  const cp = db.getChannelPerms(spaceName, channelName);
  return !cp || db.roleRank(role) >= (cp.post || 1);
}

// Whether a user may see a channel: a member of its server whose role meets the
// channel's view threshold. Every channel-scoped event goes through this (or
// deliverToChannelViewers) so private channels never leak.
function canView(spaceName, channelName, userId) {
  const space = db.getSpaceByName(spaceName);
  if (!space) return false;
  const role = db.getMemberRole(space.id, userId);
  return !!role && canViewChannel(spaceName, channelName, role);
}

// Whether `actorId` may delete someone else's message in a channel: they must
// be able to view it, their role must meet the server's
// `delete_others_messages` threshold, and the author must rank strictly below
// them (like kicking). Authors who left the server or deleted their account
// rank 0, so their messages can be cleaned up.
function canModerateMessage(spaceName, channelName, actorId, authorId) {
  const space = db.getSpaceByName(spaceName);
  if (!space) return false;
  const actorRole = db.getMemberRole(space.id, actorId);
  if (!actorRole || !canViewChannel(spaceName, channelName, actorRole)) return false;
  if (!db.canDo(space.id, actorRole, 'delete_others_messages')) return false;
  const authorRole = authorId == null ? null : db.getMemberRole(space.id, authorId);
  return db.roleRank(authorRole) < db.roleRank(actorRole);
}

module.exports = { canViewChannel, canPostChannel, canView, canModerateMessage };
