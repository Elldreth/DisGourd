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

module.exports = { canViewChannel, canPostChannel, canView };
