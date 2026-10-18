// Servers ("spaces"): settings, members, roles, invites, permissions and channels.
const { withPublicEmbeds } = require('../net/imageProxy');
const crypto = require('crypto');
const db = require('../db');
const { authUserId } = require('../auth/tokens');
const { sendJson, intParam, sanitizeCrop, readJsonBody } = require('../http/util');
const { validateSpaceName, normalizeChannelName, validateChannelName } = require('../validate');
const { canViewChannel, canPostChannel } = require('../permissions');
const { sendToUser, deliverToSpaceMembers, deliverToChannelViewers, publicPresence, tellFollow } = require('../gateway/delivery');
const { threadUpdated } = require('../gateway/chat');
const fs = require('fs');
const path = require('path');
const { uploadFilePath } = require('./uploads');
const roles = require('./roles');
const imagine = require('../imagine');

// Custom emoji images: these types, at most this big.
const EMOJI_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
const MAX_EMOJI_BYTES = 256 * 1024;

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
        return sendJson(res, 200, imagine.decorateSpaces(db.getUserSpaces(userId), userId));
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
      // What this member may do here, from their roles (P2-21b).
      const access = db.resolveAccess(space.id, userId);
      if (!access) return sendJson(res, 403, { error: 'You are not a member of this server' });
      const canManage = access.owner || access.actions.has('edit_server');
      // Roles, member roles and channel overrides (P2-21c).
      if (await roles.handle({ req, res, pathSegments, space, spaceName, userId, access, canManage })) return undefined;

      // PATCH /spaces/:name — update server settings (icon). Owner/admin only.
      if (pathSegments.length === 2 && req.method === 'PATCH') {
        if (!access.actions.has('edit_server')) return sendJson(res, 403, { error: 'You are not allowed to change server settings' });
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
        if (!access.owner) return sendJson(res, 403, { error: 'Only the owner can delete this server' });
        // Notify members over the gateway before the space (and its membership) is gone.
        deliverToSpaceMembers(spaceName, JSON.stringify({ type: 'space_deleted', space: spaceName }));
        db.deleteSpace(spaceName);
        return sendJson(res, 200, { ok: true });
      }

      // PATCH /spaces/:name/imagine { enabled?, dailyLimit? } — /imagine here
      // (P2-20a); the limit is per user per day, within the instance ceiling.
      if (pathSegments[2] === 'imagine' && pathSegments.length === 3 && req.method === 'PATCH') {
        if (!access.actions.has('edit_server')) return sendJson(res, 403, { error: 'You are not allowed to change server settings' });
        const body = await getJsonBody(req);
        const ceiling = imagine.getSettings().dailyCeiling;
        const fields = {};
        if (body.enabled !== undefined) fields.enabled = !!body.enabled;
        if (body.dailyLimit !== undefined) {
          if (body.dailyLimit !== null && !(Number.isInteger(body.dailyLimit) && body.dailyLimit >= 1 && body.dailyLimit <= ceiling)) {
            return sendJson(res, 400, { error: `The daily limit is 1–${ceiling}` });
          }
          fields.dailyLimit = body.dailyLimit;
        }
        const out = db.setSpaceImagine(space.id, fields);
        deliverToSpaceMembers(spaceName, JSON.stringify({ type: 'space_updated', space: spaceName }));
        return sendJson(res, 200, { ...out, effectiveLimit: imagine.dailyLimitFor(space.id) });
      }

      // GET /spaces/:name/members
      if (pathSegments[2] === 'members' && pathSegments.length === 3 && req.method === 'GET') {
        const memberRoles = db.getMemberRolesMap(space.id);
        const members = db.getSpaceMembers(space.id).map((m) => {
          const p = publicPresence(m.userId); // status online | idle | dnd | offline, plus custom status
          const a = db.resolveAccess(space.id, m.userId);
          const position = a ? (a.owner ? db.OWNER_POSITION : a.position) : 0;
          return { username: m.username, avatar: m.avatar, role: m.role, position, roles: memberRoles.get(m.userId) || [], ...p, online: p.status !== 'offline' };
        });
        return sendJson(res, 200, { members });
      }

      // PATCH /spaces/:name/members/:username — change a member's tier (legacy:
      // the app gives and takes roles through /members/:u/roles/:id)
      if (pathSegments[2] === 'members' && pathSegments[3] && req.method === 'PATCH') {
        if (!access.actions.has('manage_roles')) return sendJson(res, 403, { error: 'You are not allowed to change roles' });
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
        if (!access.actions.has('kick')) return sendJson(res, 403, { error: 'You are not allowed to remove members' });
        const target = db.getUserByUsername(pathSegments[3]);
        if (!target || !db.isMember(space.id, target.id)) return sendJson(res, 404, { error: 'Member not found' });
        if (target.id === userId) return sendJson(res, 400, { error: "You can't remove yourself" });
        // You can only remove someone positioned strictly below you (never the owner).
        const targetAccess = db.resolveAccess(space.id, target.id);
        if (!targetAccess || targetAccess.position >= access.position) return sendJson(res, 403, { error: 'You cannot remove this member' });
        db.removeMember(space.id, target.id);
        deliverToSpaceMembers(spaceName, JSON.stringify({ type: 'members_changed', space: spaceName }));
        sendToUser(target.id, JSON.stringify({ type: 'space_left', space: spaceName }));
        return sendJson(res, 200, { ok: true });
      }

      // POST /spaces/:name/invites — gated by the "invite" threshold
      if (pathSegments[2] === 'invites' && pathSegments.length === 3 && req.method === 'POST') {
        if (!access.actions.has('invite')) return sendJson(res, 403, { error: 'You are not allowed to invite people here' });
        const code = crypto.randomBytes(6).toString('base64url');
        db.createInvite(code, space.id, userId, null, null);
        return sendJson(res, 201, { code });
      }

      // GET /spaces/:name/permissions — server action thresholds (managers can view)
      if (pathSegments[2] === 'permissions' && pathSegments.length === 3 && req.method === 'GET') {
        if (!canManage) return sendJson(res, 403, { error: 'Only the owner or admins can view permissions' });
        return sendJson(res, 200, { permissions: db.getSpacePermissions(space.id) });
      }
      // PUT /spaces/:name/permissions — change server action thresholds (owner
      // only; legacy: sets @everyone's and Admin's permissions from the tiers)
      if (pathSegments[2] === 'permissions' && pathSegments.length === 3 && req.method === 'PUT') {
        if (!access.owner) return sendJson(res, 403, { error: 'Only the owner can change permissions' });
        const body = await getJsonBody(req);
        db.setSpacePermissions(space.id, body.permissions || body);
        deliverToSpaceMembers(spaceName, JSON.stringify({ type: 'space_updated', space: spaceName }));
        return sendJson(res, 200, { permissions: db.getSpacePermissions(space.id) });
      }

      // /spaces/:name/emoji — the server's custom emoji (P2-19a).
      if (pathSegments[2] === 'emoji') {
        if (pathSegments.length === 3 && req.method === 'GET') return sendJson(res, 200, db.getSpaceEmoji(space.id));
        if (!access.actions.has('manage_emoji')) return sendJson(res, 403, { error: 'You are not allowed to manage emoji here' });
        if (pathSegments.length === 3 && req.method === 'POST') {
          const body = await getJsonBody(req);
          const filePath = uploadFilePath(body.url);
          if (!filePath) return sendJson(res, 400, { error: 'The image must be one of this server’s uploads' });
          if (!EMOJI_EXTENSIONS.has(path.extname(filePath).toLowerCase())) return sendJson(res, 400, { error: 'Emoji must be a PNG, JPG, GIF or WebP image' });
          let stat;
          try {
            stat = fs.statSync(filePath);
          } catch {
            return sendJson(res, 400, { error: 'That upload was not found' });
          }
          if (!stat.isFile()) return sendJson(res, 400, { error: 'That upload was not found' });
          if (stat.size > MAX_EMOJI_BYTES) return sendJson(res, 413, { error: 'Emoji images must be 256 KB or smaller' });
          const result = db.addSpaceEmoji(space.id, body.name, body.url, userId);
          if (result.error === 'bad_name') return sendJson(res, 400, { error: 'Names are 2–32 letters, numbers or underscores' });
          if (result.error === 'taken') return sendJson(res, 409, { error: 'That name is already used on this server' });
          if (result.error === 'full') return sendJson(res, 409, { error: `A server can have at most ${db.MAX_EMOJI_PER_SPACE} emoji` });
          deliverToSpaceMembers(spaceName, JSON.stringify({ type: 'space_updated', space: spaceName }));
          return sendJson(res, 201, result);
        }
        if (pathSegments.length === 4 && req.method === 'DELETE') {
          if (!db.deleteSpaceEmoji(space.id, pathSegments[3])) return sendJson(res, 404, { error: 'No emoji by that name' });
          deliverToSpaceMembers(spaceName, JSON.stringify({ type: 'space_updated', space: spaceName }));
          return sendJson(res, 200, { ok: true });
        }
        return sendJson(res, 404, { error: 'Not found' });
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
          if (!canViewChannel(spaceName, channelName, userId)) return sendJson(res, 403, { error: 'You cannot view this channel' });
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
          if (!canViewChannel(spaceName, channelName, userId)) return sendJson(res, 403, { error: 'You cannot view this channel' });
          return sendJson(res, 200, withPublicEmbeds(db.getPins(spaceName, channelName)));
        }
        // Threads (P2-22a): POST starts one from a message here (anyone who can
        // post); GET lists them, newest activity first (?archived=1 for archived).
        if (channelName && pathSegments[4] === 'threads' && pathSegments.length === 5 && (req.method === 'POST' || req.method === 'GET')) {
          const type = db.channelType(spaceName, channelName);
          if (!type) return sendJson(res, 404, { error: 'Channel not found' });
          if (!canViewChannel(spaceName, channelName, userId)) return sendJson(res, 403, { error: 'You cannot view this channel' });
          if (type !== 'text') return sendJson(res, 400, { error: 'Threads can only be started in text channels' });
          if (req.method === 'GET') return sendJson(res, 200, db.getThreads(spaceName, channelName, parsedUrl.query.archived === '1', userId));
          if (!canPostChannel(spaceName, channelName, userId)) return sendJson(res, 403, { error: 'You cannot post in this channel' });
          const body = await getJsonBody(req);
          const messageId = parseInt(body.messageId, 10);
          const result = messageId > 0 ? db.createThread(spaceName, channelName, messageId, body.name, userId) : { error: 'not_found' };
          if (result.error === 'not_found') return sendJson(res, 404, { error: 'Message not found in this channel' });
          if (result.error) return sendJson(res, 400, { error: 'Thread name must be 1–80 characters' });
          if (result.created) {
            deliverToChannelViewers(spaceName, channelName, JSON.stringify({ type: 'thread_created', space: spaceName, channel: channelName, thread: result.thread }));
            tellFollow(userId, spaceName, result.thread, true); // you follow what you start
          }
          return sendJson(res, result.created ? 201 : 200, { thread: result.thread });
        }
        // PUT/DELETE follow — follow or unfollow a thread by hand (viewers only).
        if (channelName && db.isThreadChannel(channelName) && pathSegments[4] === 'follow' && pathSegments.length === 5 && (req.method === 'PUT' || req.method === 'DELETE')) {
          const threadId = db.threadChannelId(spaceName, channelName);
          if (!threadId) return sendJson(res, 404, { error: 'Thread not found' });
          if (!canViewChannel(spaceName, channelName, userId)) return sendJson(res, 403, { error: 'You cannot view this thread' });
          const followed = req.method === 'PUT';
          const changed = followed ? db.followThread(userId, threadId) : db.unfollowThread(userId, threadId);
          if (changed) tellFollow(userId, spaceName, db.getThread(spaceName, channelName), followed);
          return sendJson(res, 200, { followed });
        }
        // PUT/DELETE archive — archive or reopen a thread by hand (people who
        // may pin messages). Viewers are told with thread_updated.
        if (channelName && db.isThreadChannel(channelName) && pathSegments[4] === 'archive' && pathSegments.length === 5 && (req.method === 'PUT' || req.method === 'DELETE')) {
          if (!db.threadChannelId(spaceName, channelName)) return sendJson(res, 404, { error: 'Thread not found' });
          if (!canViewChannel(spaceName, channelName, userId)) return sendJson(res, 403, { error: 'You cannot view this thread' });
          if (!access.actions.has('pin_messages')) return sendJson(res, 403, { error: 'You are not allowed to archive threads here' });
          if (db.setThreadArchived(spaceName, channelName, req.method === 'PUT')) threadUpdated(spaceName, channelName);
          return sendJson(res, 200, { thread: db.getThread(spaceName, channelName) });
        }
        // Thread channels are managed through their parent, not as channels.
        if (channelName && db.isThreadChannel(channelName) && (req.method === 'DELETE' || pathSegments[4] === 'permissions')) {
          return sendJson(res, 404, { error: 'Channel not found' });
        }
        // PATCH channel permissions — view/post minimum ranks (managers only;
        // legacy: the app sets per-role overrides through …/overrides)
        if (channelName && pathSegments[4] === 'permissions' && req.method === 'PATCH') {
          if (!canManage) return sendJson(res, 403, { error: 'Only the owner or admins can change channel access' });
          if (!canViewChannel(spaceName, channelName, userId)) return sendJson(res, 403, { error: 'You cannot view this channel' });
          const body = await getJsonBody(req);
          const ok = db.setChannelPerms(spaceName, channelName, body.view, body.post);
          if (!ok) return sendJson(res, 404, { error: 'Channel not found' });
          deliverToSpaceMembers(spaceName, JSON.stringify({ type: 'space_updated', space: spaceName }));
          return sendJson(res, 200, { ok: true });
        }
        // PATCH a channel { nsfw } — mark it Age-restricted (18+) (managers only)
        if (channelName && pathSegments.length === 4 && req.method === 'PATCH') {
          if (!canManage) return sendJson(res, 403, { error: 'Only the owner or admins can change channel settings' });
          if (!canViewChannel(spaceName, channelName, userId)) return sendJson(res, 403, { error: 'You cannot view this channel' });
          const body = await getJsonBody(req);
          if (typeof body.nsfw !== 'boolean') return sendJson(res, 400, { error: 'nsfw must be true or false' });
          if (!db.setChannelNsfw(spaceName, channelName, body.nsfw)) return sendJson(res, 404, { error: 'Channel not found' });
          deliverToSpaceMembers(spaceName, JSON.stringify({ type: 'space_updated', space: spaceName }));
          return sendJson(res, 200, { nsfw: body.nsfw });
        }
        // POST create channel — gated by the "create_channel" threshold
        if (!channelName && req.method === 'POST') {
          if (!access.actions.has('create_channel')) return sendJson(res, 403, { error: 'You are not allowed to create channels here' });
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
          if (!access.actions.has('delete_channel')) return sendJson(res, 403, { error: 'You are not allowed to delete channels here' });
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
