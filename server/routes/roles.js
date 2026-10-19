// Roles (P2-21c): the roles screen, giving and taking roles, and per-channel
// overrides. Mounted inside the spaces route once membership is known.
// Hierarchy: you manage only roles strictly below your own highest (the owner:
// all of them), only members below you (or yourself), and you can't grant or
// revoke a permission you don't hold.
const db = require('../db');
const { sendJson, readJsonBody } = require('../http/util');
const { deliverToSpaceMembers } = require('../gateway/delivery');

const COLOR_RE = /^#[0-9a-f]{6}$/i;
const MAX_ROLES = 50;

const isBelow = (access, role) => access.owner || role.position < access.position;

// { name } or { error }.
function cleanName(raw) {
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (!name || name.length > 32) return { error: 'Role names are 1–32 characters' };
  if (name.toLowerCase() === '@everyone') return { error: 'That name is reserved' };
  return { name };
}
// undefined (not given), null (no colour), '#rrggbb', or false (invalid).
function cleanColor(raw) {
  if (raw === undefined) return undefined;
  if (raw === null || raw === '') return null;
  return typeof raw === 'string' && COLOR_RE.test(raw) ? raw.toLowerCase() : false;
}
// Known action names only, once each.
const cleanList = (raw) => (Array.isArray(raw) ? Array.from(new Set(raw.filter((a) => Object.prototype.hasOwnProperty.call(db.DEFAULT_PERMISSIONS, a)))) : null);
// Every permission switched on or off must be one the actor holds.
function mayChange(access, before, after) {
  const changed = [...after.filter((a) => !before.includes(a)), ...before.filter((a) => !after.includes(a))];
  return changed.every((a) => access.actions.has(a));
}
// 1 allow, 0 deny, null default.
const tri = (v) => (v === 1 || v === true ? 1 : v === 0 || v === false ? 0 : null);

// The roles, highest first, with who holds each.
function rolesView(spaceId) {
  const holders = db.getRoleHolders(spaceId);
  return db.getRoles(spaceId).reverse().map((r) => ({ ...r, members: r.isDefault ? [] : holders.get(r.id) || [] }));
}

// Returns true when it handled the request.
async function handle({ req, res, pathSegments: seg, space, spaceName, userId, access, canManage }) {
  const reply = (status, body) => {
    sendJson(res, status, body);
    return true;
  };
  // Role changes can move abilities, channels and badges: members_changed
  // makes clients reload the member list, the roles and their servers.
  const rolesChanged = () => deliverToSpaceMembers(spaceName, JSON.stringify({ type: 'members_changed', space: spaceName }));

  // ---- /spaces/:s/roles ----
  if (seg[2] === 'roles') {
    if (seg.length === 3 && req.method === 'GET') return reply(200, { roles: rolesView(space.id) });
    if (!access.actions.has('manage_roles')) return reply(403, { error: 'You are not allowed to manage roles' });

    // POST — a new role at the bottom.
    if (seg.length === 3 && req.method === 'POST') {
      const body = await readJsonBody(req);
      const name = cleanName(body.name);
      if (name.error) return reply(400, { error: name.error });
      const color = cleanColor(body.color);
      if (color === false) return reply(400, { error: 'Colours are #rrggbb' });
      const permissions = cleanList(body.permissions) || [];
      if (!mayChange(access, [], permissions)) return reply(403, { error: "You can't grant a permission you don't have" });
      if (db.getRoles(space.id).length >= MAX_ROLES) return reply(409, { error: `A server can have at most ${MAX_ROLES} roles` });
      const role = db.createRoleAtBottom(space.id, { name: name.name, color: color ?? null, permissions });
      if (!role) return reply(409, { error: 'A role with that name already exists' });
      rolesChanged();
      return reply(201, { role });
    }

    // PUT order { ids } — the roles you manage, bottom to top.
    if (seg.length === 4 && seg[3] === 'order' && req.method === 'PUT') {
      const { ids } = await readJsonBody(req);
      const mine = db.getRoles(space.id).filter((r) => !r.isDefault && isBelow(access, r)).map((r) => r.id);
      const list = Array.isArray(ids) ? ids.map(Number) : [];
      const same = list.length === mine.length && new Set(list).size === list.length && list.every((id) => mine.includes(id));
      if (!same) return reply(400, { error: 'List every role you manage, once, bottom to top' });
      db.reorderRoles(space.id, list);
      rolesChanged();
      return reply(200, { roles: rolesView(space.id) });
    }

    const role = seg.length === 4 ? db.getRole(space.id, parseInt(seg[3], 10)) : null;
    if (!role) return reply(404, { error: 'Role not found' });
    if (!isBelow(access, role)) return reply(403, { error: 'You can only manage roles below your own' });

    // PATCH { name?, color?, permissions? } — @everyone: permissions only.
    if (req.method === 'PATCH') {
      const body = await readJsonBody(req);
      const fields = {};
      if (body.name !== undefined && !role.isDefault) {
        const name = cleanName(body.name);
        if (name.error) return reply(400, { error: name.error });
        if (name.name !== role.name && db.getRoles(space.id).some((r) => r.name === name.name)) return reply(409, { error: 'A role with that name already exists' });
        fields.name = name.name;
      }
      if (!role.isDefault) {
        const color = cleanColor(body.color);
        if (color === false) return reply(400, { error: 'Colours are #rrggbb' });
        if (color !== undefined) fields.color = color;
      }
      if (body.permissions !== undefined) {
        const permissions = cleanList(body.permissions);
        if (!permissions) return reply(400, { error: 'permissions must be a list' });
        if (!mayChange(access, role.permissions, permissions)) return reply(403, { error: "You can't grant or remove a permission you don't have" });
        fields.permissions = permissions;
      }
      const updated = db.updateRole(space.id, role.id, fields);
      rolesChanged();
      return reply(200, { role: updated });
    }
    if (req.method === 'DELETE') {
      if (role.isDefault) return reply(400, { error: "@everyone can't be deleted" });
      db.deleteRole(space.id, role.id);
      rolesChanged();
      return reply(200, { ok: true });
    }
    return reply(404, { error: 'Not found' });
  }

  // ---- PUT/DELETE /spaces/:s/members/:u/roles/:id — give or take a role ----
  if (seg[2] === 'members' && seg[4] === 'roles' && seg.length === 6 && (req.method === 'PUT' || req.method === 'DELETE')) {
    if (!access.actions.has('manage_roles')) return reply(403, { error: 'You are not allowed to manage roles' });
    const target = db.getUserByUsername(seg[3]);
    if (!target || !db.isMember(space.id, target.id)) return reply(404, { error: 'Member not found' });
    const role = db.getRole(space.id, parseInt(seg[5], 10));
    if (!role) return reply(404, { error: 'Role not found' });
    if (role.isDefault) return reply(400, { error: 'Everyone has @everyone' });
    if (!isBelow(access, role)) return reply(403, { error: 'You can only give or take roles below your own' });
    const targetAccess = db.resolveAccess(space.id, target.id);
    if (target.id !== userId && !access.owner && targetAccess.position >= access.position) {
      return reply(403, { error: "You can't change the roles of someone at or above you" });
    }
    const changed = req.method === 'PUT' ? db.addMemberRole(space.id, target.id, role.id) : db.removeMemberRole(space.id, target.id, role.id);
    if (changed) rolesChanged();
    return reply(200, { roles: db.getMemberRoleIds(space.id, target.id) });
  }

  // ---- GET/PUT /spaces/:s/channels/:c/overrides — per-role allow/deny ----
  if (seg[2] === 'channels' && seg[3] && seg[4] === 'overrides' && seg.length === 5 && (req.method === 'GET' || req.method === 'PUT')) {
    const ref = db.channelRef(spaceName, seg[3]);
    if (!ref || db.isThreadChannel(seg[3])) return reply(404, { error: 'Channel not found' });
    if (!canManage) return reply(403, { error: 'Only the owner or admins can change channel access' });
    if (!access.channel(ref.channelId).view) return reply(403, { error: 'You cannot view this channel' });
    if (req.method === 'PUT') {
      const { overrides } = await readJsonBody(req);
      if (!Array.isArray(overrides)) return reply(400, { error: 'overrides must be a list' });
      const roles = new Map(db.getRoles(space.id).map((r) => [r.id, r]));
      for (const o of overrides) {
        const role = roles.get(Number(o && o.roleId));
        if (!role) return reply(400, { error: 'Unknown role' });
        if (!role.isDefault && !isBelow(access, role)) return reply(403, { error: 'You can only set access for roles below your own' });
      }
      for (const o of overrides) db.setChannelOverride(ref.channelId, Number(o.roleId), { view: tri(o.view), post: tri(o.post) });
      deliverToSpaceMembers(spaceName, JSON.stringify({ type: 'space_updated', space: spaceName }));
    }
    return reply(200, { overrides: db.getChannelOverrides(ref.channelId) });
  }

  // ---- Category permissions (P3-25d): GET/PUT /spaces/:s/categories/:id/overrides,
  // and POST …/apply to copy them onto every channel in it (that I can see). ----
  if (seg[2] === 'categories' && seg[3] && (seg[4] === 'overrides' || seg[4] === 'apply') && seg.length === 5) {
    const categoryId = Number(seg[3]);
    if (!db.getCategories(space.id).some((c) => c.id === categoryId)) return reply(404, { error: 'No such category' });
    if (!canManage) return reply(403, { error: 'Only the owner or admins can change category access' });
    if (seg[4] === 'apply') {
      if (req.method !== 'POST') return reply(405, { error: 'Method not allowed' });
      const visible = new Set(db.spaceChannelNames(space.id).filter((n) => { const ref = db.channelRef(spaceName, n); return ref && access.channel(ref.channelId).view; }));
      const changed = db.applyCategoryOverrides(space.id, categoryId, visible);
      deliverToSpaceMembers(spaceName, JSON.stringify({ type: 'space_updated', space: spaceName }));
      return reply(200, { changed });
    }
    if (req.method === 'PUT') {
      const { overrides } = await readJsonBody(req);
      if (!Array.isArray(overrides)) return reply(400, { error: 'overrides must be a list' });
      const roles = new Map(db.getRoles(space.id).map((r) => [r.id, r]));
      for (const o of overrides) {
        const role = roles.get(Number(o && o.roleId));
        if (!role) return reply(400, { error: 'Unknown role' });
        if (!role.isDefault && !isBelow(access, role)) return reply(403, { error: 'You can only set access for roles below your own' });
      }
      for (const o of overrides) db.setCategoryOverride(categoryId, Number(o.roleId), { view: tri(o.view), post: tri(o.post) });
    } else if (req.method !== 'GET') {
      return reply(405, { error: 'Method not allowed' });
    }
    return reply(200, { overrides: db.getCategoryOverrides(categoryId) });
  }

  return false;
}

module.exports = { handle };
