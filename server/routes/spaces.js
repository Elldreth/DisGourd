// Servers ("spaces"): settings, members, roles, invites, permissions and channels.
const { withPublicEmbeds } = require('../net/imageProxy');
const crypto = require('crypto');
const db = require('../db');
const { authUserId } = require('../auth/tokens');
const { sendJson, intParam, sanitizeCrop, readJsonBody } = require('../http/util');
const { validateSpaceName, normalizeChannelName, validateChannelName } = require('../validate');
const { canViewChannel } = require('../permissions');
const { sendToUser, deliverToSpaceMembers, deliverToChannelViewers, publicPresence } = require('../gateway/delivery');

const getJsonBody = readJsonBody;

// Tried in order; the first match handles the request.
const routes = [
  {
    // ---- Spaces (servers), channels, members, invites — membership-aware ----
    match: ({ pathSegments }) => pathSegments[0] === 'spaces',
    run: async ({ req, res, parsedUrl, pathSegments }) => {
      const userId = authUserId(req, parsedUrl);
      if (!userId) return sendJson(res, 401, { error: 'Unauthorized' });

      // GET /spaces — servers I'm a member of
      if (pathSegments.length === 1 && req.method === 'GET') {
        return sendJson(res, 200, db.getUserSpaces(userId));
      }
      // POST /spaces { name, template? } — create a server (creator becomes
      // owner) with a template's channels (default: just #general)
      if (pathSegments.length === 1 && req.method === 'POST') {
        const { name, template } = await getJsonBody(req);
        const invalid = validateSpaceName(name);
        if (invalid) return sendJson(res, 400, { error: invalid });
        const channels = db.templateChannels(template);
        const spaceId = db.createSpaceWithDefaults(name.trim(), userId, channels);
        if (!spaceId) return sendJson(res, 409, { error: 'A server with that name already exists' });
        return sendJson(res, 201, {
          name: name.trim(),
          role: 'owner',
          channels: channels.filter((c) => c.type !== 'voice').map((c) => c.name),
          voiceChannels: channels.filter((c) => c.type === 'voice').map((c) => c.name),
        });
      }

      const spaceName = pathSegments[1];
      const space = db.getSpaceByName(spaceName);
      if (!space) return sendJson(res, 404, { error: 'Server not found' });
      const role = db.getMemberRole(space.id, userId);
      if (!role) return sendJson(res, 403, { error: 'You are not a member of this server' });
      const canManage = role === 'owner' || role === 'admin';

      // PATCH /spaces/:name — update server settings (icon). Owner/admin only.
      if (pathSegments.length === 2 && req.method === 'PATCH') {
        if (!db.canDo(space.id, role, 'edit_server')) return sendJson(res, 403, { error: 'You are not allowed to change server settings' });
        const body = await getJsonBody(req);
        if ('icon' in body) {
          const icon = body.icon;
          const okUrl = (v) => v == null || v === '' || (typeof v === 'string' && v.startsWith('/uploads/'));
          if (!okUrl(icon) || !okUrl(body.iconOriginal)) {
            return sendJson(res, 400, { error: 'Invalid icon' });
          }
          db.setSpaceIcon(space.id, icon || null, body.iconOriginal || null, sanitizeCrop(body.iconCrop));
          deliverToSpaceMembers(spaceName, JSON.stringify({ type: 'space_updated', space: spaceName }));
        }
        if ('name' in body) {
          const newName = typeof body.name === 'string' ? body.name.trim() : '';
          if (!newName) return sendJson(res, 400, { error: 'Server name cannot be empty' });
          if (newName.length > 60) return sendJson(res, 400, { error: 'Server name must be 60 characters or fewer' });
          const result = db.renameSpace(space.id, newName);
          if (result.error === 'taken') return sendJson(res, 409, { error: 'Another server already uses that name' });
          if (result.error) return sendJson(res, 400, { error: 'Could not rename the server' });
          if (result.oldName !== newName) {
            // Broadcast under the new name — the old one no longer resolves.
            deliverToSpaceMembers(newName, JSON.stringify({ type: 'space_renamed', space: result.oldName, newName }));
          }
          return sendJson(res, 200, { ok: true, name: newName });
        }
        return sendJson(res, 200, { ok: true });
      }

      // DELETE /spaces/:name — owner only
      if (pathSegments.length === 2 && req.method === 'DELETE') {
        if (role !== 'owner') return sendJson(res, 403, { error: 'Only the owner can delete this server' });
        // Notify members over the gateway before the space (and its membership) is gone.
        deliverToSpaceMembers(spaceName, JSON.stringify({ type: 'space_deleted', space: spaceName }));
        db.deleteSpace(spaceName);
        return sendJson(res, 200, { ok: true });
      }

      // GET /spaces/:name/members
      if (pathSegments[2] === 'members' && pathSegments.length === 3 && req.method === 'GET') {
        const members = db.getSpaceMembers(space.id).map((m) => {
          const p = publicPresence(m.userId); // status online | idle | dnd | offline, plus custom status
          return { username: m.username, avatar: m.avatar, role: m.role, ...p, online: p.status !== 'offline' };
        });
        return sendJson(res, 200, { members });
      }

      // PATCH /spaces/:name/members/:username — change a member's role
      if (pathSegments[2] === 'members' && pathSegments[3] && req.method === 'PATCH') {
        if (!db.canDo(space.id, role, 'manage_roles')) return sendJson(res, 403, { error: 'You are not allowed to change roles' });
        const target = db.getUserByUsername(pathSegments[3]);
        if (!target || !db.isMember(space.id, target.id)) return sendJson(res, 404, { error: 'Member not found' });
        if (target.id === space.owner_id) return sendJson(res, 400, { error: "The owner's role can't be changed" });
        const { role: newRole } = await getJsonBody(req);
        if (newRole !== 'admin' && newRole !== 'member') return sendJson(res, 400, { error: 'Invalid role' });
        db.setMemberRole(space.id, target.id, newRole);
        deliverToSpaceMembers(spaceName, JSON.stringify({ type: 'members_changed', space: spaceName }));
        return sendJson(res, 200, { ok: true });
      }

      // DELETE /spaces/:name/members/:username — remove a member (owner: anyone but
      // the owner; admin: members only)
      if (pathSegments[2] === 'members' && pathSegments[3] && req.method === 'DELETE') {
        if (!db.canDo(space.id, role, 'kick')) return sendJson(res, 403, { error: 'You are not allowed to remove members' });
        const target = db.getUserByUsername(pathSegments[3]);
        if (!target || !db.isMember(space.id, target.id)) return sendJson(res, 404, { error: 'Member not found' });
        if (target.id === userId) return sendJson(res, 400, { error: "You can't remove yourself" });
        const targetRole = db.getMemberRole(space.id, target.id);
        // You can only remove someone ranked strictly below you (never the owner).
        if (db.roleRank(targetRole) >= db.roleRank(role)) return sendJson(res, 403, { error: 'You cannot remove this member' });
        db.removeMember(space.id, target.id);
        deliverToSpaceMembers(spaceName, JSON.stringify({ type: 'members_changed', space: spaceName }));
        sendToUser(target.id, JSON.stringify({ type: 'space_left', space: spaceName }));
        return sendJson(res, 200, { ok: true });
      }

      // POST /spaces/:name/invites — gated by the "invite" threshold
      if (pathSegments[2] === 'invites' && pathSegments.length === 3 && req.method === 'POST') {
        if (!db.canDo(space.id, role, 'invite')) return sendJson(res, 403, { error: 'You are not allowed to invite people here' });
        const code = crypto.randomBytes(6).toString('base64url');
        db.createInvite(code, space.id, userId, null, null);
        return sendJson(res, 201, { code });
      }

      // GET /spaces/:name/permissions — server action thresholds (managers can view)
      if (pathSegments[2] === 'permissions' && pathSegments.length === 3 && req.method === 'GET') {
        if (!canManage) return sendJson(res, 403, { error: 'Only the owner or admins can view permissions' });
        return sendJson(res, 200, { permissions: db.getSpacePermissions(space.id) });
      }
      // PUT /spaces/:name/permissions — change server action thresholds (owner only)
      if (pathSegments[2] === 'permissions' && pathSegments.length === 3 && req.method === 'PUT') {
        if (role !== 'owner') return sendJson(res, 403, { error: 'Only the owner can change permissions' });
        const body = await getJsonBody(req);
        db.setSpacePermissions(space.id, body.permissions || body);
        deliverToSpaceMembers(spaceName, JSON.stringify({ type: 'space_updated', space: spaceName }));
        return sendJson(res, 200, { permissions: db.getSpacePermissions(space.id) });
      }

      // /spaces/:name/channels ...
      if (pathSegments[2] === 'channels') {
        const channelName = pathSegments[3];
        // GET messages — must be a member AND allowed to view this channel.
        // Latest page by default; ?around=<id> is a window around one message
        // (jumping to it; 404 if it isn't in this channel), ?after=<id> loads
        // newer (up to 200 unless ?limit=), ?before=<id> pages back
        // (around > after > before > offset).
        if (channelName && pathSegments[4] === 'messages' && req.method === 'GET') {
          if (!canViewChannel(spaceName, channelName, role)) return sendJson(res, 403, { error: 'You cannot view this channel' });
          const around = intParam(parsedUrl.query.around, 0, 0, Number.MAX_SAFE_INTEGER);
          if (around > 0) {
            const rows = db.getMessagesAround(spaceName, channelName, around);
            return rows ? sendJson(res, 200, withPublicEmbeds(rows)) : sendJson(res, 404, { error: 'Message not found in this channel' });
          }
          const after = intParam(parsedUrl.query.after, 0, 0, Number.MAX_SAFE_INTEGER);
          if (after > 0) {
            const afterLimit = intParam(parsedUrl.query.limit, 200, 1, 200);
            return sendJson(res, 200, withPublicEmbeds(db.getMessagesAfter(spaceName, channelName, after, afterLimit)));
          }
          const limit = intParam(parsedUrl.query.limit, 50, 1, 200);
          const before = intParam(parsedUrl.query.before, 0, 0, Number.MAX_SAFE_INTEGER);
          if (before > 0) return sendJson(res, 200, withPublicEmbeds(db.getMessagesBefore(spaceName, channelName, before, limit)));
          const offset = intParam(parsedUrl.query.offset, 0, 0, Number.MAX_SAFE_INTEGER);
          return sendJson(res, 200, withPublicEmbeds(db.getMessages(spaceName, channelName, limit, offset)));
        }
        // GET pins — the channel's pinned messages, newest pin first (viewers only).
        if (channelName && pathSegments[4] === 'pins' && pathSegments.length === 5 && req.method === 'GET') {
          if (!canViewChannel(spaceName, channelName, role)) return sendJson(res, 403, { error: 'You cannot view this channel' });
          return sendJson(res, 200, withPublicEmbeds(db.getPins(spaceName, channelName)));
        }
        // PATCH channel permissions — view/post minimum ranks (managers only)
        if (channelName && pathSegments[4] === 'permissions' && req.method === 'PATCH') {
          if (!canManage) return sendJson(res, 403, { error: 'Only the owner or admins can change channel access' });
          if (!canViewChannel(spaceName, channelName, role)) return sendJson(res, 403, { error: 'You cannot view this channel' });
          const body = await getJsonBody(req);
          const ok = db.setChannelPerms(spaceName, channelName, body.view, body.post);
          if (!ok) return sendJson(res, 404, { error: 'Channel not found' });
          deliverToSpaceMembers(spaceName, JSON.stringify({ type: 'space_updated', space: spaceName }));
          return sendJson(res, 200, { ok: true });
        }
        // POST create channel — gated by the "create_channel" threshold
        if (!channelName && req.method === 'POST') {
          if (!db.canDo(space.id, role, 'create_channel')) return sendJson(res, 403, { error: 'You are not allowed to create channels here' });
          const { name, type } = await getJsonBody(req);
          const invalid = validateChannelName(name);
          if (invalid) return sendJson(res, 400, { error: invalid });
          const channel = normalizeChannelName(name);
          const chType = type === 'voice' ? 'voice' : 'text';
          db.createChannel(spaceName, channel, chType);
          deliverToSpaceMembers(spaceName, JSON.stringify({ type: 'channel_created', space: spaceName, channel, channelType: chType }));
          return sendJson(res, 201, { name: channel, type: chType });
        }
        // DELETE channel — gated by the "delete_channel" threshold
        if (channelName && pathSegments.length === 4 && req.method === 'DELETE') {
          if (!db.canDo(space.id, role, 'delete_channel')) return sendJson(res, 403, { error: 'You are not allowed to delete channels here' });
          deliverToChannelViewers(spaceName, channelName, JSON.stringify({ type: 'channel_deleted', space: spaceName, channel: channelName }));
          db.deleteChannel(spaceName, channelName);
          return sendJson(res, 200, { ok: true });
        }
      }

      return sendJson(res, 404, { error: 'Not found' });
    },
  },
];

// Returns true when one of these routes handled the request.
async function handle(ctx) {
  for (const route of routes) {
    if (route.match(ctx)) {
      await route.run(ctx);
      return true;
    }
  }
  return false;
}

module.exports = { handle };
