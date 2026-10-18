const db = require('./db');

// Permission checks, answered from the roles tables (P2-21b). Everything that
// gates a user goes through here or through db.resolveAccess, so private
// channels never leak and a role change applies everywhere at once.

// What `userId` may do in a server: null for a non-member; otherwise
// { owner, actions (a Set of action names), position (their highest role's,
// Infinity for the owner) } and, with `channelId`, view / post for that channel.
function resolvePermissions(spaceId, userId, channelId = null) {
  const access = db.resolveAccess(spaceId, userId);
  if (!access) return null;
  const out = { owner: access.owner, actions: access.actions, position: access.position };
  if (channelId != null) Object.assign(out, access.channel(channelId));
  return out;
}

// The ids behind a (server name, channel name) pair, or null if unknown.
function channelRef(spaceName, channelName) {
  return db.channelRef(spaceName, channelName);
}

// Per-channel gates. Unknown channels return true so normal 404 handling
// applies elsewhere; non-members are always refused.
function canViewChannel(spaceName, channelName, userId) {
  const ref = channelRef(spaceName, channelName);
  if (!ref) return true;
  const access = db.resolveAccess(ref.spaceId, userId);
  return !!access && access.channel(ref.channelId).view;
}
function canPostChannel(spaceName, channelName, userId) {
  const ref = channelRef(spaceName, channelName);
  if (!ref) return true;
  const access = db.resolveAccess(ref.spaceId, userId);
  return !!access && access.channel(ref.channelId).post;
}

// Whether a member may perform a server action (create channels, pin, kick…).
function canDoAction(spaceId, userId, action) {
  const access = db.resolveAccess(spaceId, userId);
  return !!access && access.actions.has(action);
}

// Whether a user may see a channel: a member of its server whose roles allow
// viewing it. Every channel-scoped event goes through this (or
// deliverToChannelViewers) so private channels never leak.
function canView(spaceName, channelName, userId) {
  const space = db.getSpaceByName(spaceName);
  if (!space) return false;
  return db.isMember(space.id, userId) && canViewChannel(spaceName, channelName, userId);
}

// Whether `actorId` may delete someone else's message in a channel: they must
// be able to view it, hold `delete_others_messages`, and the author must sit
// strictly below them (like kicking). Authors who left the server or deleted
// their account sit below everyone, so their messages can be cleaned up.
function canModerateMessage(spaceName, channelName, actorId, authorId) {
  const space = db.getSpaceByName(spaceName);
  if (!space) return false;
  const actor = db.resolveAccess(space.id, actorId);
  if (!actor || !canViewChannel(spaceName, channelName, actorId)) return false;
  if (!actor.actions.has('delete_others_messages')) return false;
  const author = authorId == null ? null : db.resolveAccess(space.id, authorId);
  return (author ? author.position : -1) < actor.position;
}

module.exports = { canViewChannel, canPostChannel, canView, canModerateMessage, canDoAction, resolvePermissions };
