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

// ---- Roles (P2-21a) ----
// What `userId` may do in a server, read from the roles tables. null for a
// non-member; otherwise { owner, actions (a Set of action names), position
// (their highest role's, Infinity for the owner), and with `channelId`,
// view / post }. The owner may do everything. Channel access: the
// @everyone override first, then the member's own roles: an allow from any
// of them wins, else a deny from any, else what @everyone said (default
// allowed). Posting needs viewing.
// Not used by the live checks yet (P2-21b); P2-21a proves it agrees with them.
function resolvePermissions(spaceId, userId, channelId = null) {
  const space = db.getSpaceById(spaceId);
  if (!space || !db.isMember(spaceId, userId)) return null;
  const owner = Number(space.owner_id) === Number(userId);
  const roles = db.getRoles(spaceId);
  const everyone = roles.find((r) => r.isDefault) || null;
  const mineIds = new Set(db.getMemberRoleIds(spaceId, userId));
  const mine = roles.filter((r) => mineIds.has(r.id));
  const actions = new Set();
  for (const r of [everyone, ...mine]) if (r) for (const a of r.permissions) actions.add(a);
  if (owner) for (const a of Object.keys(db.DEFAULT_PERMISSIONS)) actions.add(a);
  const position = owner ? Infinity : mine.reduce((top, r) => Math.max(top, r.position), everyone ? everyone.position : 0);
  const out = { owner, actions, position };
  if (channelId != null) {
    if (owner) {
      out.view = true;
      out.post = true;
    } else {
      const overrides = db.getChannelOverrides(channelId);
      const decide = (field) => {
        const base = everyone ? overrides.find((o) => o.roleId === everyone.id)?.[field] : null;
        let allowed = base == null ? true : base === 1;
        const own = overrides.filter((o) => mineIds.has(o.roleId)).map((o) => o[field]).filter((v) => v != null);
        if (own.includes(1)) allowed = true;
        else if (own.includes(0)) allowed = false;
        return allowed;
      };
      out.view = decide('view');
      out.post = out.view && decide('post');
    }
  }
  return out;
}

module.exports = { canViewChannel, canPostChannel, canView, canModerateMessage, resolvePermissions };
