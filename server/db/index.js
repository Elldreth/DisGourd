const path = require('path');
const Database = require('better-sqlite3');
const { runMigrations } = require('./migrations');
const { normalizeRegCode } = require('../auth/regCodes');
require('dotenv').config({ quiet: true });

// Tests must say which database to use (usually ':memory:'). Without this, a
// test that loads a module too early would silently open the real database.
if (process.env.NODE_ENV === 'test' && !process.env.DB_PATH) {
  throw new Error('Tests must set DB_PATH (e.g. ":memory:") before loading the database; refusing to open the real one.');
}
const dbPath = process.env.DB_PATH || path.join(__dirname, 'disgourd.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
// Wait up to 5s for a lock instead of failing at once (e.g. while a backup
// runs), and fsync less often: NORMAL is safe with WAL.
db.pragma('busy_timeout = 5000');
db.pragma('synchronous = NORMAL');

// Create or upgrade the schema. A failed migration throws here, which stops
// the server from starting on a half-upgraded database.
const versionBefore = db.pragma('user_version', { simple: true });
runMigrations(db);

// Bootstrap (every boot, not a migration): if there are users but none is a
// site admin, promote the earliest.
const anyAdmin = db.prepare('SELECT 1 FROM users WHERE site_admin = 1 LIMIT 1').get();
if (!anyAdmin) {
  const first = db.prepare('SELECT id FROM users WHERE is_bot = 0 ORDER BY id LIMIT 1').get();
  if (first) db.prepare('UPDATE users SET site_admin = 1 WHERE id = ?').run(first.id);
}

// ---- Referential integrity ----
// The schema declares foreign keys, but SQLite only enforces them when
// `PRAGMA foreign_keys` is on for the connection, which it never was: the
// ON DELETE cascades never ran, so deleting a server left its channels,
// messages, members and invites behind. Remove any orphans that accumulated
// (children before grandchildren), then turn enforcement on.
const NOT_A_USER = (col) => `${col} NOT IN (SELECT id FROM users)`;
const ORPHAN_CLEANUP = [
  'DELETE FROM channels WHERE space_id NOT IN (SELECT id FROM spaces)',
  'DELETE FROM messages WHERE channel_id NOT IN (SELECT id FROM channels)',
  `UPDATE messages SET author_id = NULL WHERE author_id IS NOT NULL AND ${NOT_A_USER('author_id')}`,
  `DELETE FROM reactions WHERE message_id NOT IN (SELECT id FROM messages) OR ${NOT_A_USER('user_id')}`,
  `DELETE FROM mentions WHERE message_id NOT IN (SELECT id FROM messages) OR ${NOT_A_USER('user_id')}`,
  `DELETE FROM space_members WHERE space_id NOT IN (SELECT id FROM spaces) OR ${NOT_A_USER('user_id')}`,
  'DELETE FROM invites WHERE space_id NOT IN (SELECT id FROM spaces)',
  `UPDATE invites SET created_by = NULL WHERE created_by IS NOT NULL AND ${NOT_A_USER('created_by')}`,
  `DELETE FROM friend_requests WHERE ${NOT_A_USER('from_user')} OR ${NOT_A_USER('to_user')}`,
  `DELETE FROM friends WHERE ${NOT_A_USER('user_id')} OR ${NOT_A_USER('friend_id')}`,
  `DELETE FROM user_blocks WHERE ${NOT_A_USER('blocker_id')} OR ${NOT_A_USER('blocked_id')}`, // P9-07a
  // P9-06a: someone gone leaves their conversations; a conversation (and its
  // messages) goes once nobody is left in it.
  `DELETE FROM dm_participants WHERE ${NOT_A_USER('user_id')}`,
  'DELETE FROM dm_conversations WHERE id NOT IN (SELECT conversation_id FROM dm_participants)',
  'DELETE FROM dm_messages WHERE conversation_id IS NOT NULL AND conversation_id NOT IN (SELECT id FROM dm_conversations)',
];

// Returns the number of rows removed or detached.
function cleanupOrphans() {
  let changed = 0;
  db.transaction(() => {
    for (const sql of ORPHAN_CLEANUP) changed += db.prepare(sql).run().changes;
  })();
  return changed;
}

// foreign_key_check is empty on a healthy database, so the cleanup effectively
// runs once (on the first start after upgrading) and is a no-op afterwards.
if (db.pragma('foreign_key_check').length > 0) {
  const changed = cleanupOrphans();
  console.warn(`[db] Cleaned up ${changed} orphaned row(s) before enabling foreign keys`);
}
db.pragma('foreign_keys = ON');

// ---- Role-based permissions ----
const ROLE_RANK = { member: 1, admin: 2, owner: 3 };
function roleRank(role) {
  return ROLE_RANK[role] || 0;
}

// Server actions and their default minimum rank. Owner (3) always passes.
const DEFAULT_PERMISSIONS = {
  create_channel: 2,
  delete_channel: 2,
  invite: 1,
  kick: 2,
  ban_members: 2,
  timeout_members: 2,
  edit_server: 2,
  delete_others_messages: 2,
  pin_messages: 2,
  manage_emoji: 2,
  manage_roles: 3,
  generate_images: 2,
};

// ---- Custom server emoji (P2-19) ----
const EMOJI_NAME_RE = /^[a-z0-9_]{2,32}$/;
const MAX_EMOJI_PER_SPACE = 50;

// A server's emoji, by name: [{ id, name, url, createdBy }].
function getSpaceEmoji(spaceId) {
  return db.prepare(`
    SELECT e.id, e.name, e.url, u.username AS createdBy
    FROM space_emoji e LEFT JOIN users u ON u.id = e.created_by
    WHERE e.space_id = ? ORDER BY e.name
  `).all(spaceId);
}

// Add one. Returns the row, or { error: 'bad_name' | 'taken' | 'full' }.
const addSpaceEmoji = db.transaction((spaceId, rawName, url, userId) => {
  const name = String(rawName || '').trim().toLowerCase();
  if (!EMOJI_NAME_RE.test(name)) return { error: 'bad_name' };
  if (db.prepare('SELECT 1 FROM space_emoji WHERE space_id = ? AND name = ?').get(spaceId, name)) return { error: 'taken' };
  const count = db.prepare('SELECT COUNT(*) AS n FROM space_emoji WHERE space_id = ?').get(spaceId).n;
  if (count >= MAX_EMOJI_PER_SPACE) return { error: 'full' };
  const info = db.prepare('INSERT INTO space_emoji(space_id, name, url, created_by, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(spaceId, name, url, userId || null, Date.now());
  return getSpaceEmoji(spaceId).find((e) => e.id === info.lastInsertRowid);
});

// Whether the server named `spaceName` has emoji `id` called `name`.
function spaceHasEmoji(spaceName, id, name) {
  return !!db.prepare(`
    SELECT 1 FROM space_emoji e JOIN spaces s ON s.id = e.space_id WHERE s.name = ? AND e.id = ? AND e.name = ?
  `).get(spaceName, id, name);
}

function deleteSpaceEmoji(spaceId, name) {
  return db.prepare('DELETE FROM space_emoji WHERE space_id = ? AND name = ?').run(spaceId, String(name || '').toLowerCase()).changes > 0;
}

// ---- Roles (P2-21a) ----
// A server's roles: `@everyone` (is_default, position 0) which every member
// has, and any others. The roles tables are the source of truth (P2-21c): the
// full re-seed from the tier columns (syncSpaceRoles) runs only for a new
// server and the v12 upgrade; the legacy tier helpers write only what they
// name (applyTierPermissions, applyTierChannel, the Admin membership).
const shapeRole = (r) => ({
  id: r.id, name: r.name, color: r.color || null, position: r.position, isDefault: !!r.is_default,
  permissions: (() => { try { return JSON.parse(r.permissions) || []; } catch { return []; } })(),
});
function getRoles(spaceId) {
  return db.prepare('SELECT * FROM roles WHERE space_id = ? ORDER BY position, id').all(spaceId).map(shapeRole);
}
function getRole(spaceId, roleId) {
  const r = db.prepare('SELECT * FROM roles WHERE space_id = ? AND id = ?').get(spaceId, roleId);
  return r ? shapeRole(r) : null;
}
const cleanPermissions = (list) => Array.from(new Set((Array.isArray(list) ? list : []).filter((a) => Object.prototype.hasOwnProperty.call(DEFAULT_PERMISSIONS, a))));
// Create a role above the existing ones. Returns it, or null when the name is taken.
function createRole(spaceId, { name, color = null, permissions = [], position } = {}) {
  const top = db.prepare('SELECT COALESCE(MAX(position), -1) AS p FROM roles WHERE space_id = ?').get(spaceId).p;
  const info = db.prepare('INSERT OR IGNORE INTO roles(space_id, name, color, position, permissions, is_default, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)')
    .run(spaceId, String(name || '').trim(), color || null, position == null ? top + 1 : position, JSON.stringify(cleanPermissions(permissions)), Date.now());
  return info.changes ? getRole(spaceId, info.lastInsertRowid) : null;
}
function updateRole(spaceId, roleId, { name, color, permissions, position } = {}) {
  const r = getRole(spaceId, roleId);
  if (!r) return null;
  db.prepare('UPDATE roles SET name = ?, color = ?, permissions = ?, position = ? WHERE id = ?').run(
    name == null || r.isDefault ? r.name : String(name).trim(),
    color === undefined ? r.color : color || null,
    JSON.stringify(permissions === undefined ? r.permissions : cleanPermissions(permissions)),
    position == null || r.isDefault ? r.position : position,
    roleId
  );
  return getRole(spaceId, roleId);
}
function deleteRole(spaceId, roleId) {
  return db.prepare('DELETE FROM roles WHERE space_id = ? AND id = ? AND is_default = 0').run(spaceId, roleId).changes > 0;
}
function getMemberRoleIds(spaceId, userId) {
  return db.prepare('SELECT role_id FROM member_roles WHERE space_id = ? AND user_id = ? ORDER BY role_id').all(spaceId, userId).map((r) => r.role_id);
}
function addMemberRole(spaceId, userId, roleId) {
  return db.prepare('INSERT OR IGNORE INTO member_roles(space_id, user_id, role_id) VALUES (?, ?, ?)').run(spaceId, userId, roleId).changes > 0;
}
function removeMemberRole(spaceId, userId, roleId) {
  return db.prepare('DELETE FROM member_roles WHERE space_id = ? AND user_id = ? AND role_id = ?').run(spaceId, userId, roleId).changes > 0;
}
// A new role from the roles screen goes to the bottom, just above @everyone
// (the others move up one). null when the name is taken.
const createRoleAtBottom = db.transaction((spaceId, fields = {}) => {
  if (db.prepare('SELECT 1 FROM roles WHERE space_id = ? AND name = ?').get(spaceId, String(fields.name || '').trim())) return null;
  db.prepare('UPDATE roles SET position = position + 1 WHERE space_id = ? AND is_default = 0').run(spaceId);
  return createRole(spaceId, { ...fields, position: 1 });
});
// Reorder roles within the positions they already hold: `ids` bottom to top.
const reorderRoles = db.transaction((spaceId, ids) => {
  const slots = ids.map((id) => getRole(spaceId, id).position).sort((a, b) => a - b);
  const set = db.prepare('UPDATE roles SET position = ? WHERE space_id = ? AND id = ?');
  ids.forEach((id, i) => set.run(slots[i], spaceId, id));
});
// Who holds each role: Map roleId -> [username].
function getRoleHolders(spaceId) {
  const out = new Map();
  for (const r of db.prepare(`
    SELECT mr.role_id AS roleId, u.username FROM member_roles mr JOIN users u ON u.id = mr.user_id
    WHERE mr.space_id = ? ORDER BY u.username COLLATE NOCASE
  `).all(spaceId)) {
    if (!out.has(r.roleId)) out.set(r.roleId, []);
    out.get(r.roleId).push(r.username);
  }
  return out;
}
// Each member's roles (besides @everyone): Map userId -> [roleId].
function getMemberRolesMap(spaceId) {
  const out = new Map();
  for (const r of db.prepare('SELECT user_id AS userId, role_id AS roleId FROM member_roles WHERE space_id = ? ORDER BY role_id').all(spaceId)) {
    if (!out.has(r.userId)) out.set(r.userId, []);
    out.get(r.userId).push(r.roleId);
  }
  return out;
}
// A channel's overrides: [{ roleId, view, post }] with 1 allow, 0 deny, null inherit.
function getChannelOverrides(channelId) {
  return db.prepare('SELECT role_id AS roleId, view, post FROM channel_role_overrides WHERE channel_id = ?').all(channelId);
}
function setChannelOverride(channelId, roleId, { view = null, post = null } = {}) {
  const norm = (v) => (v === 1 || v === true ? 1 : v === 0 || v === false ? 0 : null);
  const v = norm(view);
  const p = norm(post);
  if (v === null && p === null) {
    db.prepare('DELETE FROM channel_role_overrides WHERE channel_id = ? AND role_id = ?').run(channelId, roleId);
    return;
  }
  db.prepare(`
    INSERT INTO channel_role_overrides(channel_id, role_id, view, post) VALUES (?, ?, ?, ?)
    ON CONFLICT(channel_id, role_id) DO UPDATE SET view = excluded.view, post = excluded.post
  `).run(channelId, roleId, v, p);
}

// ---- Category permissions (P3-25d) ----
function getCategoryOverrides(categoryId) {
  return db.prepare('SELECT role_id AS roleId, view, post FROM category_role_overrides WHERE category_id = ?').all(categoryId);
}
function setCategoryOverride(categoryId, roleId, { view = null, post = null } = {}) {
  const norm = (v) => (v === 1 || v === true ? 1 : v === 0 || v === false ? 0 : null);
  const v = norm(view);
  const p = norm(post);
  if (v === null && p === null) {
    db.prepare('DELETE FROM category_role_overrides WHERE category_id = ? AND role_id = ?').run(categoryId, roleId);
    return;
  }
  db.prepare(`
    INSERT INTO category_role_overrides(category_id, role_id, view, post) VALUES (?, ?, ?, ?)
    ON CONFLICT(category_id, role_id) DO UPDATE SET view = excluded.view, post = excluded.post
  `).run(categoryId, roleId, v, p);
}
// A channel's access becomes a copy of its category's (no link afterwards).
// Only when the category has any: a plain category leaves the channel as it is.
function copyCategoryOverrides(categoryId, channelId) {
  const rows = categoryId == null ? [] : getCategoryOverrides(categoryId);
  if (!rows.length) return false;
  db.prepare('DELETE FROM channel_role_overrides WHERE channel_id = ?').run(channelId);
  const put = db.prepare('INSERT INTO channel_role_overrides(channel_id, role_id, view, post) VALUES (?, ?, ?, ?)');
  for (const r of rows) put.run(channelId, r.roleId, r.view, r.post);
  return true;
}
// "Apply to all channels in this category": the ones listed (those the person
// can see). Returns how many were changed.
const applyCategoryOverrides = db.transaction((spaceId, categoryId, visibleNames) => {
  const rows = getCategoryOverrides(categoryId);
  const chans = db.prepare("SELECT id, name FROM channels WHERE space_id = ? AND category_id = ? AND type IS NOT 'thread'").all(spaceId, categoryId)
    .filter((c) => visibleNames.has(c.name));
  const put = db.prepare('INSERT INTO channel_role_overrides(channel_id, role_id, view, post) VALUES (?, ?, ?, ?)');
  for (const c of chans) {
    db.prepare('DELETE FROM channel_role_overrides WHERE channel_id = ?').run(c.id);
    for (const r of rows) put.run(c.id, r.roleId, r.view, r.post);
  }
  return chans.length;
});

// A tier threshold as a seeded role's override: 0 deny, 1 allow, null default.
const tierOverride = (threshold, rank) => (threshold > rank ? 0 : threshold === rank && rank > 1 ? 1 : null);
const tierAllowed = (perms, max) => Object.keys(DEFAULT_PERMISSIONS).filter((a) => (perms[a] || 3) <= max);
const hasRoles = (spaceId) => !!db.prepare('SELECT 1 FROM roles WHERE space_id = ? AND is_default = 1').get(spaceId);
// The seeded Admin role (what the tier helpers call "admin"), or null once
// it has been renamed or deleted on the roles screen.
const seededAdminId = (spaceId) => db.prepare("SELECT id FROM roles WHERE space_id = ? AND name = 'Admin' AND is_default = 0").get(spaceId)?.id ?? null;

// Re-derive the seeded roles from the tier data for one server: @everyone
// gets the actions whose threshold is 1, Admin those up to 2; admins hold
// Admin; each channel's view/post thresholds become overrides (2: deny
// @everyone and allow Admin; 3: deny both). Custom roles are left alone.
// Idempotent, and what the migration runs for every existing server.
const syncSpaceRoles = db.transaction((spaceId) => {
  const perms = getSpacePermissions(spaceId);
  const now = Date.now();
  const upsert = db.prepare(`
    INSERT INTO roles(space_id, name, color, position, permissions, is_default, created_at) VALUES (?, ?, NULL, ?, ?, ?, ?)
    ON CONFLICT(space_id, name) DO UPDATE SET permissions = excluded.permissions
  `);
  const allowed = (max) => JSON.stringify(tierAllowed(perms, max));
  upsert.run(spaceId, '@everyone', 0, allowed(1), 1, now);
  upsert.run(spaceId, 'Admin', 1, allowed(2), 0, now);
  const everyone = db.prepare('SELECT id FROM roles WHERE space_id = ? AND is_default = 1').get(spaceId).id;
  const admin = db.prepare("SELECT id FROM roles WHERE space_id = ? AND name = 'Admin'").get(spaceId).id;
  // Admin memberships follow the admin tier exactly.
  db.prepare('DELETE FROM member_roles WHERE space_id = ? AND role_id = ?').run(spaceId, admin);
  db.prepare(`INSERT INTO member_roles(space_id, user_id, role_id) SELECT space_id, user_id, ? FROM space_members WHERE space_id = ? AND role = 'admin'`).run(admin, spaceId);
  // Channel thresholds become overrides for the two seeded roles.
  const setOv = db.prepare(`
    INSERT INTO channel_role_overrides(channel_id, role_id, view, post) VALUES (?, ?, ?, ?)
    ON CONFLICT(channel_id, role_id) DO UPDATE SET view = excluded.view, post = excluded.post
  `);
  const delOv = db.prepare('DELETE FROM channel_role_overrides WHERE channel_id = ? AND role_id = ?');
  for (const c of db.prepare('SELECT id, view_role, post_role FROM channels WHERE space_id = ?').all(spaceId)) {
    for (const [roleId, rank] of [[everyone, 1], [admin, 2]]) {
      const v = tierOverride(c.view_role || 1, rank);
      const p = tierOverride(c.post_role || 1, rank);
      if (v === null && p === null) delOv.run(c.id, roleId);
      else setOv.run(c.id, roleId, v, p);
    }
  }
});
// Legacy tier helpers (the existing endpoints and tests), written as targeted
// updates so they never undo what the roles screen set. A server without
// roles yet (made through the bare helpers) gets the full seed instead.
function applyTierPermissions(spaceId) {
  if (!hasRoles(spaceId)) return syncSpaceRoles(spaceId);
  const perms = getSpacePermissions(spaceId);
  db.prepare('UPDATE roles SET permissions = ? WHERE space_id = ? AND is_default = 1').run(JSON.stringify(tierAllowed(perms, 1)), spaceId);
  const admin = seededAdminId(spaceId);
  if (admin) db.prepare('UPDATE roles SET permissions = ? WHERE id = ?').run(JSON.stringify(tierAllowed(perms, 2)), admin);
}
function applyTierChannel(spaceId, channelId, view, post) {
  if (!hasRoles(spaceId)) return syncSpaceRoles(spaceId);
  const everyone = db.prepare('SELECT id FROM roles WHERE space_id = ? AND is_default = 1').get(spaceId).id;
  for (const [roleId, rank] of [[everyone, 1], [seededAdminId(spaceId), 2]]) {
    if (roleId) setChannelOverride(channelId, roleId, { view: tierOverride(view, rank), post: tierOverride(post, rank) });
  }
}
function applyTierMember(spaceId, userId, role) {
  if (!hasRoles(spaceId)) return syncSpaceRoles(spaceId);
  const admin = seededAdminId(spaceId);
  if (!admin) return;
  if (role === 'admin') addMemberRole(spaceId, userId, admin);
  else removeMemberRole(spaceId, userId, admin);
}
// What a member may do in a server, read from the roles tables (P2-21b).
// null for a non-member; otherwise { owner, actions: Set, position, roleIds,
// channel(channelId) -> { view, post } }. The owner may do everything. Channel
// access: @everyone's override first, then the member's own roles: an allow
// from any of them wins, else a deny from any, else what @everyone said
// (default allowed). Posting needs viewing. One call reads everything it
// needs, so looping over a server's channels costs nothing more.
function resolveAccess(spaceId, userId) {
  const space = getSpaceById(spaceId);
  if (!space || !isMember(spaceId, userId)) return null;
  const owner = Number(space.owner_id) === Number(userId);
  const roles = getRoles(spaceId);
  const everyone = roles.find((r) => r.isDefault) || null;
  const roleIds = new Set(getMemberRoleIds(spaceId, userId));
  const mine = roles.filter((r) => roleIds.has(r.id));
  const actions = new Set();
  for (const r of [everyone, ...mine]) if (r) for (const a of r.permissions) actions.add(a);
  if (owner) for (const a of Object.keys(DEFAULT_PERMISSIONS)) actions.add(a);
  const position = owner ? Infinity : mine.reduce((top, r) => Math.max(top, r.position), everyone ? everyone.position : 0);
  const byChannel = new Map();
  for (const o of db.prepare(`
    SELECT o.channel_id AS channelId, o.role_id AS roleId, o.view, o.post
    FROM channel_role_overrides o JOIN channels c ON c.id = o.channel_id WHERE c.space_id = ?
  `).all(spaceId)) {
    if (!byChannel.has(o.channelId)) byChannel.set(o.channelId, []);
    byChannel.get(o.channelId).push(o);
  }
  // A thread answers with its parent channel's overrides.
  const parentOf = new Map(db.prepare('SELECT id, parent_id FROM channels WHERE space_id = ? AND parent_id IS NOT NULL').all(spaceId).map((c) => [c.id, c.parent_id]));
  const channel = (channelId) => {
    if (owner) return { view: true, post: true };
    const id = parentOf.get(Number(channelId)) ?? Number(channelId);
    const ovs = byChannel.get(id) || [];
    const decide = (field) => {
      const base = everyone ? ovs.find((o) => o.roleId === everyone.id)?.[field] : null;
      let allowed = base == null ? true : base === 1;
      const own = ovs.filter((o) => roleIds.has(o.roleId)).map((o) => o[field]).filter((v) => v != null);
      if (own.includes(1)) allowed = true;
      else if (own.includes(0)) allowed = false;
      return allowed;
    };
    const view = decide('view');
    return { view, post: view && decide('post') };
  };
  // What @everyone alone gets in a channel (its own override, default
  // allowed), whoever is asking: the channel list marks private and
  // read-only channels from this.
  const everyoneChannel = (channelId) => {
    const id = parentOf.get(Number(channelId)) ?? Number(channelId);
    const ov = everyone ? (byChannel.get(id) || []).find((o) => o.roleId === everyone.id) : null;
    const view = ov?.view == null ? true : ov.view === 1;
    return { view, post: view && (ov?.post == null ? true : ov.post === 1) };
  };
  return { owner, actions, position, roleIds, channel, everyoneChannel };
}

// The ids behind a (server name, channel name) pair, or null if unknown.
function channelRef(spaceName, channelName) {
  const row = db.prepare('SELECT c.id AS channelId, c.space_id AS spaceId FROM channels c JOIN spaces s ON c.space_id = s.id WHERE s.name = ? AND c.name = ?').get(spaceName, channelName);
  return row || null;
}

// Every channel id the user may view, across all their servers (the unread,
// mention and search queries filter on this).
function visibleChannelIds(userId) {
  const ids = [];
  for (const m of db.prepare('SELECT space_id FROM space_members WHERE user_id = ?').all(userId)) {
    const access = resolveAccess(m.space_id, userId);
    if (!access) continue;
    for (const c of db.prepare('SELECT id FROM channels WHERE space_id = ?').all(m.space_id)) if (access.channel(c.id).view) ids.push(c.id);
  }
  return ids;
}
// The channels of one server this person can't see (P11-13, L3): moderators
// get no reports, counts or log lines from them.
function hiddenChannelNames(spaceId, userId) {
  const access = resolveAccess(spaceId, userId);
  const all = db.prepare('SELECT id, name FROM channels WHERE space_id = ?').all(spaceId);
  return all.filter((c) => !access || !access.channel(c.id).view).map((c) => c.name);
}
// `c.id IN (...)` for a list of ids (an empty list matches nothing).
const inList = (ids) => (ids.length ? `(${ids.map(() => '?').join(',')})` : '(NULL)');

// Seed (or refresh) the tier-derived roles of every server.
function seedAllSpaceRoles() {
  for (const s of db.prepare('SELECT id FROM spaces').all()) syncSpaceRoles(s.id);
}

// Merge a space's stored permission overrides onto the defaults.
function getSpacePermissions(spaceId) {
  const row = db.prepare('SELECT permissions FROM spaces WHERE id = ?').get(spaceId);
  let stored = {};
  if (row && row.permissions) {
    try {
      stored = JSON.parse(row.permissions) || {};
    } catch {
      stored = {};
    }
  }
  const out = { ...DEFAULT_PERMISSIONS };
  for (const k of Object.keys(DEFAULT_PERMISSIONS)) {
    const v = parseInt(stored[k], 10);
    if (v >= 1 && v <= 3) out[k] = v;
  }
  return out;
}

function setSpacePermissions(spaceId, perms) {
  const clean = {};
  for (const k of Object.keys(DEFAULT_PERMISSIONS)) {
    const v = parseInt(perms && perms[k], 10);
    // manage_roles stays owner-only; never let it drop below owner.
    const min = k === 'manage_roles' ? 3 : 1;
    if (v >= min && v <= 3) clean[k] = v;
  }
  db.prepare('UPDATE spaces SET permissions = ? WHERE id = ?').run(JSON.stringify(clean), spaceId);
  applyTierPermissions(spaceId);
}

// Whether a *tier* may perform a server action. Legacy: production checks use
// the roles tables (resolveAccess / permissions.js); the roles equivalence
// test keeps this to compare against.
function canDo(spaceId, role, action) {
  return roleRank(role) >= (getSpacePermissions(spaceId)[action] || 3);
}

// A thread answers with its parent's roles (they're also copied onto the
// thread row, so queries that filter on c.view_role stay right).
function getChannelPerms(spaceName, channelName) {
  return db.prepare(`
    SELECT COALESCE(p.view_role, c.view_role) AS view, COALESCE(p.post_role, c.post_role) AS post
    FROM channels c JOIN spaces s ON c.space_id = s.id
    LEFT JOIN channels p ON p.id = c.parent_id
    WHERE s.name = ? AND c.name = ?
  `).get(spaceName, channelName) || null;
}

function setChannelPerms(spaceName, channelName, viewRole, postRole) {
  const v = Math.min(3, Math.max(1, parseInt(viewRole, 10) || 1));
  // You can't post somewhere you can't see, so post threshold >= view threshold.
  const p = Math.min(3, Math.max(v, parseInt(postRole, 10) || 1));
  const ok = db.prepare(`
    UPDATE channels SET view_role = ?, post_role = ?
    WHERE space_id = (SELECT id FROM spaces WHERE name = ?) AND name = ? AND type IS NOT 'thread'
  `).run(v, p, spaceName, channelName).changes > 0;
  // Its threads follow at once.
  if (ok) {
    db.prepare(`
      UPDATE channels SET view_role = ?, post_role = ?
      WHERE parent_id = (SELECT c.id FROM channels c JOIN spaces s ON c.space_id = s.id WHERE s.name = ? AND c.name = ?)
    `).run(v, p, spaceName, channelName);
    const ref = channelRef(spaceName, channelName);
    applyTierChannel(ref.spaceId, ref.channelId, v, p);
  }
  return ok;
}

// Parse the stored attachments JSON into an array, falling back to the single
// attachment column for older rows. Mutates and returns the row.
function hydrateAttachments(row) {
  if (!row) return row;
  let list = [];
  if (row.attachments) {
    try {
      const parsed = JSON.parse(row.attachments);
      if (Array.isArray(parsed)) list = parsed.filter((u) => typeof u === 'string');
    } catch {
      /* ignore malformed */
    }
  }
  if (list.length === 0 && row.attachment) list = [row.attachment];
  row.attachments = list;
  return row;
}

function createSpace(name) {
  const stmt = db.prepare('INSERT OR IGNORE INTO spaces(name) VALUES (?)');
  stmt.run(name);
}

// A new channel goes at the end of a category: the one asked for (if it's
// this server's), else the server's "Text channels" / "Voice channels" if it
// still has one, else the uncategorized top (P3-25a).
function createChannel(spaceName, channelName, type = 'text', categoryId) {
  createSpace(spaceName);
  const space = db.prepare('SELECT id FROM spaces WHERE name = ?').get(spaceName);
  const kind = type === 'voice' ? 'voice' : 'text';
  const category = categoryId !== undefined ? categoryOf(space.id, categoryId) : defaultCategory(space.id, kind);
  const info = db.prepare('INSERT OR IGNORE INTO channels(space_id, name, type, category_id, position) VALUES (?, ?, ?, ?, ?)')
    .run(space.id, channelName, kind, category, nextChannelPosition(space.id, category));
  const made = info.changes > 0;
  if (made && !hasRoles(space.id)) syncSpaceRoles(space.id); // seed a bare server's roles
  if (made) copyCategoryOverrides(category, Number(info.lastInsertRowid)); // P3-25d: start with the category's access
  return made;
}

// ---- Channel categories (P3-25a) ----
const DEFAULT_CATEGORY = { text: 'Text channels', voice: 'Voice channels' };
// A category id if it belongs to this server, else null (uncategorized).
function categoryOf(spaceId, categoryId) {
  if (categoryId == null) return null;
  const row = db.prepare('SELECT id FROM channel_categories WHERE id = ? AND space_id = ?').get(categoryId, spaceId);
  return row ? row.id : null;
}
function defaultCategory(spaceId, kind) {
  const row = db.prepare('SELECT id FROM channel_categories WHERE space_id = ? AND name = ? ORDER BY position LIMIT 1').get(spaceId, DEFAULT_CATEGORY[kind]);
  return row ? row.id : null;
}
function nextChannelPosition(spaceId, categoryId) {
  return db.prepare("SELECT COALESCE(MAX(position) + 1, 0) AS p FROM channels WHERE space_id = ? AND category_id IS ? AND type IS NOT 'thread'").get(spaceId, categoryId).p;
}
// A server's channel names (no threads), for checking a layout.
function spaceChannelNames(spaceId) {
  return db.prepare("SELECT name FROM channels WHERE space_id = ? AND type IS NOT 'thread'").all(spaceId).map((r) => r.name);
}
// A server's categories in order: [{ id, name, position }].
function getCategories(spaceId) {
  // hasOverrides (P3-25d): whether moving a channel in replaces its access.
  return db.prepare(`
    SELECT id, name, position, EXISTS(SELECT 1 FROM category_role_overrides o WHERE o.category_id = k.id) AS hasOverrides
    FROM channel_categories k WHERE space_id = ? ORDER BY position, id
  `).all(spaceId).map((c) => ({ ...c, hasOverrides: !!c.hasOverrides }));
}
function createCategory(spaceId, name) {
  const pos = db.prepare('SELECT COALESCE(MAX(position) + 1, 0) AS p FROM channel_categories WHERE space_id = ?').get(spaceId).p;
  const id = Number(db.prepare('INSERT INTO channel_categories(space_id, name, position) VALUES (?, ?, ?)').run(spaceId, name, pos).lastInsertRowid);
  return { id, name, position: pos };
}
function renameCategory(spaceId, categoryId, name) {
  return db.prepare('UPDATE channel_categories SET name = ? WHERE id = ? AND space_id = ?').run(name, categoryId, spaceId).changes > 0;
}
// Deleting a category keeps its channels: they join the uncategorized top,
// after what's there, in their order. Positions are then made contiguous.
const deleteCategory = db.transaction((spaceId, categoryId) => {
  if (!categoryOf(spaceId, categoryId)) return false;
  let next = nextChannelPosition(spaceId, null);
  const move = db.prepare('UPDATE channels SET category_id = NULL, position = ? WHERE id = ?');
  for (const c of db.prepare('SELECT id FROM channels WHERE category_id = ? ORDER BY position, id').all(categoryId)) move.run(next++, c.id);
  db.prepare('DELETE FROM channel_categories WHERE id = ?').run(categoryId);
  const renumber = db.prepare('UPDATE channel_categories SET position = ? WHERE id = ?');
  getCategories(spaceId).forEach((c, i) => renumber.run(i, c.id));
  return true;
});
// Rearrange a server in one go: `categories` is every category id in its new
// order; `channels` is [{ name, category }] for the channels this person can
// see, in their new order. Channels they can't see keep their category and
// follow the listed ones in it, in their old order. Returns { error } or { ok }.
const setLayout = db.transaction((spaceId, categories, channels, visible) => {
  const known = getCategories(spaceId).map((c) => c.id);
  if (!Array.isArray(categories) || categories.length !== known.length || new Set(categories).size !== known.length || !categories.every((id) => known.includes(id))) {
    return { error: 'The layout must list each of this server’s categories once' };
  }
  const all = db.prepare("SELECT id, name, category_id AS category FROM channels WHERE space_id = ? AND type IS NOT 'thread' ORDER BY position, id").all(spaceId);
  const seen = all.filter((c) => visible.has(c.name));
  if (!Array.isArray(channels) || channels.length !== seen.length || new Set(channels.map((c) => c && c.name)).size !== seen.length
    || !channels.every((c) => c && visible.has(c.name) && seen.some((s) => s.name === c.name) && (c.category === null || known.includes(c.category)))) {
    return { error: 'The layout must list each channel you can see once, in a category of this server or none' };
  }
  categories.forEach((id, i) => db.prepare('UPDATE channel_categories SET position = ? WHERE id = ?').run(i, id));
  const byName = new Map(all.map((c) => [c.name, c]));
  const place = db.prepare('UPDATE channels SET category_id = ?, position = ? WHERE id = ?');
  for (const group of [null, ...categories]) {
    const listed = channels.filter((c) => c.category === group).map((c) => byName.get(c.name));
    const hidden = all.filter((c) => !visible.has(c.name) && c.category === group);
    [...listed, ...hidden].forEach((c, i) => place.run(group, i, c.id));
  }
  // P3-25d: a channel moved into a different category takes a copy of that
  // category's access (if it has any); moved to the top, it keeps its own.
  const copied = [];
  for (const c of channels) {
    const before = byName.get(c.name);
    if (c.category !== null && c.category !== before.category && copyCategoryOverrides(c.category, before.id)) copied.push(c.name);
  }
  return { ok: true, copied };
});

function channelType(spaceName, channelName) {
  const row = db.prepare(`
    SELECT c.type FROM channels c JOIN spaces s ON c.space_id = s.id
    WHERE s.name = ? AND c.name = ?
  `).get(spaceName, channelName);
  return row ? row.type : null;
}

function deleteSpace(name) {
  const stmt = db.prepare('DELETE FROM spaces WHERE name = ?');
  return stmt.run(name).changes > 0;
}

function deleteChannel(spaceName, channelName) {
  const stmt = db.prepare(`
    DELETE FROM channels WHERE id IN (
      SELECT c.id FROM channels c
      JOIN spaces s ON c.space_id = s.id
      WHERE s.name = ? AND c.name = ?
    )`);
  return stmt.run(spaceName, channelName).changes > 0;
}

// Rename a channel (P6-03). Everything else points at its id; read_state is
// keyed by name, so it moves in the same transaction. Threads can't be
// renamed. Returns { oldName, newName }, or { error: 'not_found' | 'taken' }.
function renameChannel(spaceName, channelName, newName) {
  const row = db.prepare(`
    SELECT c.id, c.space_id FROM channels c JOIN spaces s ON c.space_id = s.id
    WHERE s.name = ? AND c.name = ? AND c.type IS NOT 'thread'
  `).get(spaceName, channelName);
  if (!row) return { error: 'not_found' };
  if (newName === channelName) return { oldName: channelName, newName };
  if (db.prepare('SELECT 1 FROM channels WHERE space_id = ? AND name = ?').get(row.space_id, newName)) return { error: 'taken' };
  db.transaction(() => {
    db.prepare('UPDATE read_state SET channel = ? WHERE space = ? AND channel = ?').run(newName, spaceName, channelName);
    db.prepare('UPDATE channels SET name = ? WHERE id = ?').run(newName, row.id);
  })();
  return { oldName: channelName, newName };
}

// ---- Spaces: ownership, membership, invites ----

// Rename a space. read_state is keyed by space *name*, so migrate those rows in
// the same transaction or unread tracking would break. Returns { name } on
// success, or { error: 'taken' } if another space already uses the new name.
function renameSpace(spaceId, newName) {
  const current = db.prepare('SELECT name FROM spaces WHERE id = ?').get(spaceId);
  if (!current) return { error: 'not_found' };
  if (current.name === newName) return { name: newName, oldName: current.name };
  const clash = db.prepare('SELECT 1 FROM spaces WHERE name = ? AND id != ?').get(newName, spaceId);
  if (clash) return { error: 'taken' };
  db.transaction(() => {
    db.prepare('UPDATE read_state SET space = ? WHERE space = ?').run(newName, current.name);
    db.prepare('UPDATE spaces SET name = ? WHERE id = ?').run(newName, spaceId);
  })();
  return { name: newName, oldName: current.name };
}

function getSpaceByName(name) {
  if (typeof name !== 'string') return undefined;
  return db.prepare('SELECT id, name, owner_id FROM spaces WHERE name = ?').get(name);
}

function getSpaceById(id) {
  return db.prepare('SELECT id, name, owner_id FROM spaces WHERE id = ?').get(id);
}
// The server's name and icon, for an invite's public preview (P14-01).
function getSpaceCard(id) {
  return db.prepare('SELECT id, name, icon_url AS icon FROM spaces WHERE id = ?').get(id);
}

// Create a space owned by ownerId and enrol them as its owner. Returns the new
// space id, or null if the name is already taken.
function createSpaceOwned(name, ownerId) {
  const info = db.prepare('INSERT OR IGNORE INTO spaces(name, owner_id) VALUES (?, ?)').run(name, ownerId);
  if (info.changes === 0) return null;
  const spaceId = info.lastInsertRowid;
  addMember(spaceId, ownerId, 'owner');
  return spaceId;
}

function addMember(spaceId, userId, role = 'member') {
  const added = db.prepare('INSERT OR IGNORE INTO space_members(space_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)')
    .run(spaceId, userId, role, Date.now()).changes > 0;
  if (added && role === 'admin') applyTierMember(spaceId, userId, 'admin');
}

function removeMember(spaceId, userId) {
  return db.prepare('DELETE FROM space_members WHERE space_id = ? AND user_id = ?')
    .run(spaceId, userId).changes > 0;
}

// Leave a server (P6-01): the membership (roles go with it by cascade), plus
// this user's read markers and thread follows there, in one transaction.
function leaveSpace(spaceId, userId) {
  return db.transaction(() => {
    const space = db.prepare('SELECT name FROM spaces WHERE id = ?').get(spaceId);
    if (space) db.prepare('DELETE FROM read_state WHERE user_id = ? AND space = ?').run(userId, space.name);
    db.prepare(`DELETE FROM thread_follows WHERE user_id = ?
      AND channel_id IN (SELECT id FROM channels WHERE space_id = ?)`).run(userId, spaceId);
    return removeMember(spaceId, userId);
  })();
}

function getMemberRole(spaceId, userId) {
  const row = db.prepare('SELECT role FROM space_members WHERE space_id = ? AND user_id = ?').get(spaceId, userId);
  return row ? row.role : null;
}

function setMemberRole(spaceId, userId, role) {
  const changed = db.prepare('UPDATE space_members SET role = ? WHERE space_id = ? AND user_id = ?')
    .run(role, spaceId, userId).changes > 0;
  if (changed) applyTierMember(spaceId, userId, role);
  return changed;
}

// Hand a server to another member (P9-02). The old owner becomes an Admin:
// the seeded Admin role, or (if that was renamed or deleted) the highest role
// there is. Returns the name of the role they got, or null if there's none.
const transferOwnership = db.transaction((spaceId, fromId, toId) => {
  db.prepare('UPDATE spaces SET owner_id = ? WHERE id = ?').run(toId, spaceId);
  // The legacy tier column follows (the roles tables are what count).
  db.prepare("UPDATE space_members SET role = 'owner' WHERE space_id = ? AND user_id = ?").run(spaceId, toId);
  db.prepare("UPDATE space_members SET role = 'admin' WHERE space_id = ? AND user_id = ?").run(spaceId, fromId);
  const roles = getRoles(spaceId).filter((r) => !r.isDefault);
  const admin = roles.find((r) => r.id === seededAdminId(spaceId)) || roles[roles.length - 1] || null;
  if (admin) addMemberRole(spaceId, fromId, admin.id);
  return admin ? admin.name : null;
});

function isMember(spaceId, userId) {
  return !!db.prepare('SELECT 1 FROM space_members WHERE space_id = ? AND user_id = ?').get(spaceId, userId);
}

// The owner's position as sent to clients (JSON has no Infinity).
const OWNER_POSITION = 1e9;

// Spaces the user belongs to, each with its channels and the user's role.
function getUserSpaces(userId) {
  const spaces = db.prepare(`
    SELECT s.id, s.name, s.icon_url AS icon, s.icon_original AS iconOriginal, s.icon_crop AS iconCrop, sm.role
    FROM space_members sm
    JOIN spaces s ON sm.space_id = s.id
    WHERE sm.user_id = ?
    ORDER BY s.name COLLATE NOCASE
  `).all(userId);
  // In layout order (P3-25a): the uncategorized top, then each category in
  // order, channels by position within each.
  const channelStmt = db.prepare(`
    SELECT c.id, c.name, c.type, c.view_role AS view, c.post_role AS post, c.nsfw, c.topic, c.category_id AS category, c.position, c.slowmode_seconds AS slowmode
    FROM channels c LEFT JOIN channel_categories k ON k.id = c.category_id
    WHERE c.space_id = ? AND c.type IS NOT 'thread'
    ORDER BY k.id IS NOT NULL, k.position, k.id, c.position, c.id
  `);
  const emojiStmt = db.prepare('SELECT id, name, url FROM space_emoji WHERE space_id = ? ORDER BY name');
  return spaces.map((s) => {
    // Members only see channels their roles allow them to view; `canPost`
    // and `abilities` tell the client what it may offer (the server checks too).
    const access = resolveAccess(s.id, userId);
    const chans = channelStmt.all(s.id)
      .map((c) => ({ ...c, can: access ? access.channel(c.id) : { view: false, post: false } }))
      .filter((c) => c.can.view);
    // `private` / `readOnly` say what @everyone may do there (from the role
    // overrides); `view` / `post` are the legacy tier columns, kept as-is.
    const channelMeta = {};
    for (const c of chans) {
      const ev = access.everyoneChannel(c.id);
      channelMeta[c.name] = {
        type: c.type, view: c.view || 1, post: c.post || 1, canPost: c.can.post, nsfw: !!c.nsfw, topic: c.topic || null, private: !ev.view, readOnly: ev.view && !ev.post,
        category: c.category ?? null, position: c.position, // P3-25a
        slowmode: c.slowmode || 0, // P3-26d: seconds, 0 = off
      };
    }
    return {
      name: s.name,
      icon: s.icon || null,
      iconOriginal: s.iconOriginal || null,
      iconCrop: s.iconCrop ? JSON.parse(s.iconCrop) : null,
      role: s.role,
      owner: !!(access && access.owner),
      position: access ? (access.owner ? OWNER_POSITION : access.position) : 0,
      abilities: access ? [...access.actions] : [],
      permissions: getSpacePermissions(s.id),
      // The server's own emoji, so :name: can render client-side.
      emoji: emojiStmt.all(s.id),
      channels: chans.filter((c) => c.type !== 'voice').map((c) => c.name),
      voiceChannels: chans.filter((c) => c.type === 'voice').map((c) => c.name),
      channelMeta,
      categories: getCategories(s.id), // P3-25a: in order
      timeout: getMemberTimeout(s.id, userId), // P3-26c: { until, reason } while I'm timed out
      // P9-01: open reports, for the people who handle them.
      ...(access && (access.owner || access.actions.has('delete_others_messages')) ? { openReports: countOpenReports(s.id, hiddenChannelNames(s.id, userId)) } : {}),
    };
  });
}

// Set (or clear, with null) a server's icon image, keeping the original upload
// and crop box so it can be re-framed later without re-uploading.
function setSpaceIcon(spaceId, url, originalUrl = null, crop = null) {
  db.prepare('UPDATE spaces SET icon_url = ?, icon_original = ?, icon_crop = ? WHERE id = ?')
    .run(url || null, originalUrl || null, crop ? JSON.stringify(crop) : null, spaceId);
}

function getSpaceMembers(spaceId) {
  return db.prepare(`
    SELECT u.id AS userId, u.username, u.avatar_url AS avatar, sm.role
    FROM space_members sm
    JOIN users u ON sm.user_id = u.id
    WHERE sm.space_id = ?
    ORDER BY CASE sm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.username COLLATE NOCASE
  `).all(spaceId);
}

function createInvite(code, spaceId, createdBy, expiresAt = null, maxUses = null) {
  db.prepare(`
    INSERT INTO invites(code, space_id, created_by, created_at, expires_at, max_uses, uses)
    VALUES (?, ?, ?, ?, ?, ?, 0)
  `).run(code, spaceId, createdBy, Date.now(), expiresAt, maxUses);
}

// P14-01: case, spaces and dashes don't matter (the P13-01 rule); an exact
// match wins if two codes only differ in case.
function getInvite(code) {
  const norm = normalizeRegCode(code);
  if (!norm) return undefined;
  return db.prepare(`
    SELECT * FROM invites WHERE replace(upper(code), '-', '') = ?
    ORDER BY (code = ?) DESC, rowid DESC LIMIT 1
  `).get(norm, String(code).trim());
}

function incrementInviteUses(code) {
  db.prepare('UPDATE invites SET uses = uses + 1 WHERE code = ?').run(code);
}

function storeMessage(spaceName, channelName, content, authorId, attachments = [], spoiler = false, replyTo = null) {
  createChannel(spaceName, channelName);
  const channel = db.prepare(`
    SELECT c.id FROM channels c
    JOIN spaces s ON c.space_id = s.id
    WHERE s.name = ? AND c.name = ?
  `).get(spaceName, channelName);
  if (!channel) return null;
  const list = Array.isArray(attachments) ? attachments : (attachments ? [attachments] : []);
  const first = list[0] || null;
  const json = list.length ? JSON.stringify(list) : null;
  const createdAt = Date.now();
  const info = db.prepare(
    'INSERT INTO messages(channel_id, content, author_id, attachment_url, attachments, attachment_spoiler, created_at, reply_to) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(channel.id, content, authorId || null, first, json, spoiler ? 1 : 0, createdAt, replyTo || null);
  // Posting in a thread counts as activity and reopens it if it was archived.
  db.prepare("UPDATE channels SET last_activity_at = ?, archived_at = NULL WHERE id = ? AND type = 'thread'")
    .run(createdAt, channel.id);
  return { id: info.lastInsertRowid, timestamp: createdAt };
}

// Canonical message projection shared by history and backfill queries.
// `timestamp` is always epoch milliseconds; `attachment` is the stored URL.
const MESSAGE_SELECT = `
  SELECT m.id,
         m.content,
         m.attachment_url AS attachment,
         m.attachments AS attachments,
         m.attachment_spoiler AS spoiler,
         COALESCE(m.created_at, CAST(strftime('%s', m.timestamp) AS INTEGER) * 1000) AS timestamp,
         m.edited_at AS editedAt,
         m.author_id AS authorId,
         u.username AS author,
         u.avatar_url AS authorAvatar,
         u.is_bot AS bot,
         m.reply_to AS replyToId,
         p.id AS replyFoundId,
         p.content AS replyContent,
         p.attachment_url AS replyAttachment,
         p.attachments AS replyAttachments,
         p.author_id AS replyAuthorId,
         pu.username AS replyAuthor,
         (pin.message_id IS NOT NULL) AS pinned,
         th.id AS threadId,
         th.name AS threadChannel,
         th.thread_name AS threadName,
         th.last_activity_at AS threadLastActivityAt,
         th.archived_at AS threadArchivedAt,
         CASE WHEN th.id IS NULL THEN NULL
              ELSE (SELECT COUNT(*) FROM messages tm WHERE tm.channel_id = th.id) END AS threadCount,
         CASE WHEN u.is_bot = 1 THEN (SELECT ij.engine FROM imagine_jobs ij WHERE ij.message_id = m.id ORDER BY ij.id DESC LIMIT 1) END AS imagineEngine
  FROM messages m
  JOIN channels c ON m.channel_id = c.id
  JOIN spaces s ON c.space_id = s.id
  LEFT JOIN users u ON m.author_id = u.id
  LEFT JOIN messages p ON p.id = m.reply_to
  LEFT JOIN users pu ON pu.id = p.author_id
  LEFT JOIN pins pin ON pin.message_id = m.id
  LEFT JOIN channels th ON th.root_message_id = m.id AND th.type = 'thread'
`;

// The short quote shown above a reply: the first 100 characters with
// ||spoilers|| hidden, or "Attachment" for an attachment-only message.
function replySnippet(content, hasAttachment) {
  const text = String(content || '').replace(/\|\|[\s\S]+?\|\|/g, '(spoiler)').replace(/\s+/g, ' ').trim();
  if (text) return text.slice(0, 100);
  return hasAttachment ? 'Attachment' : '';
}

// Turn the reply_* columns into `replyTo`: null (not a reply), { id, deleted }
// (original gone), or { id, authorId, author, snippet }.
const REPLY_COLUMNS = ['replyToId', 'replyFoundId', 'replyContent', 'replyAttachment', 'replyAttachments', 'replyAuthorId', 'replyAuthor'];
function hydrateReply(row) {
  if (!row) return row;
  const r = {};
  for (const k of REPLY_COLUMNS) {
    r[k] = row[k];
    delete row[k];
  }
  if (r.replyToId == null) row.replyTo = null;
  else if (r.replyFoundId == null) row.replyTo = { id: r.replyToId, deleted: true };
  else {
    row.replyTo = {
      id: r.replyFoundId,
      authorId: r.replyAuthorId,
      author: r.replyAuthor || 'Unknown',
      snippet: replySnippet(r.replyContent, !!(r.replyAttachment || r.replyAttachments)),
    };
  }
  return row;
}
// `pinned` comes from the pins join (channel messages only; DMs have none).
function hydratePinned(row) {
  if (row && 'pinned' in row) row.pinned = !!row.pinned;
  return row;
}
// `thread` is the summary under a root message, or null.
const THREAD_COLUMNS = ['threadId', 'threadChannel', 'threadName', 'threadLastActivityAt', 'threadArchivedAt', 'threadCount'];
function hydrateThread(row) {
  if (!row || !('threadId' in row)) return row;
  const t = {};
  for (const k of THREAD_COLUMNS) {
    t[k] = row[k];
    delete row[k];
  }
  row.thread = t.threadId == null ? null : {
    id: t.threadId, channel: t.threadChannel, name: t.threadName, messageCount: t.threadCount, lastActivityAt: t.threadLastActivityAt,
    archived: t.threadArchivedAt != null,
  };
  return row;
}
// `bot: true` on the /imagine bot's messages only (others carry no field),
// with `imagineEngine` (P9-05a) when the message is an image job's.
function hydrateBot(row) {
  if (row && 'bot' in row) {
    if (row.bot) row.bot = true;
    else delete row.bot;
  }
  if (row && 'imagineEngine' in row && row.imagineEngine == null) delete row.imagineEngine;
  return row;
}
const hydrateMessage = (row) => hydrateBot(hydrateThread(hydratePinned(hydrateReply(hydrateAttachments(row)))));

// The quote for a new reply, if `messageId` is in that same channel (so a
// reply can never reveal a message from another, possibly private, channel).
function getReplyTarget(spaceName, channelName, messageId) {
  const row = db.prepare(`${MESSAGE_SELECT} WHERE s.name = ? AND c.name = ? AND m.id = ?`)
    .get(spaceName, channelName, messageId);
  if (!row) return null;
  return {
    id: row.id,
    authorId: row.authorId,
    author: row.author || 'Unknown',
    snippet: replySnippet(row.content, !!(row.attachment || row.attachments)),
  };
}

function getMessages(spaceName, channelName, limit = 20, offset = 0) {
  const rows = db.prepare(`${MESSAGE_SELECT}
    WHERE s.name = ? AND c.name = ?
    ORDER BY m.id DESC
    LIMIT ? OFFSET ?
  `).all(spaceName, channelName, limit, offset).reverse();
  return attachEmbeds('channel', attachReactions(rows.map(hydrateMessage)));
}

// The page of messages just older than `beforeId`, returned oldest-first — used
// to scroll back through history.
function getMessagesBefore(spaceName, channelName, beforeId, limit = 50) {
  const rows = db.prepare(`${MESSAGE_SELECT}
    WHERE s.name = ? AND c.name = ? AND m.id < ?
    ORDER BY m.id DESC
    LIMIT ?
  `).all(spaceName, channelName, beforeId, limit).reverse();
  return attachEmbeds('channel', attachReactions(rows.map(hydrateMessage)));
}

// Messages newer than a given id, oldest-first — used to backfill gaps after a
// client reconnects so no messages are missed during a network blip.
function getMessagesAfter(spaceName, channelName, afterId, limit = 200) {
  const rows = db.prepare(`${MESSAGE_SELECT}
    WHERE s.name = ? AND c.name = ? AND m.id > ?
    ORDER BY m.id ASC
    LIMIT ?
  `).all(spaceName, channelName, afterId, limit);
  return attachEmbeds('channel', attachReactions(rows.map(hydrateMessage)));
}

// A window of history around one message (for jumping to it): up to `half`
// messages before it, the message itself, and up to `half` after, oldest
// first. null if that message isn't in this channel.
function getMessagesAround(spaceName, channelName, messageId, half = 25) {
  const where = 'WHERE s.name = ? AND c.name = ?';
  if (!db.prepare(`${MESSAGE_SELECT} ${where} AND m.id = ?`).get(spaceName, channelName, messageId)) return null;
  const before = db.prepare(`${MESSAGE_SELECT} ${where} AND m.id < ? ORDER BY m.id DESC LIMIT ?`)
    .all(spaceName, channelName, messageId, half).reverse();
  const from = db.prepare(`${MESSAGE_SELECT} ${where} AND m.id >= ? ORDER BY m.id ASC LIMIT ?`)
    .all(spaceName, channelName, messageId, half + 1);
  return attachEmbeds('channel', attachReactions([...before, ...from].map(hydrateMessage)));
}

// ---- Link previews ----
// kind: 'channel' (messages) or 'dm' (dm_messages).
const EMBED_TABLE = { channel: 'message_embeds', dm: 'dm_message_embeds' };
const MESSAGE_TABLE = { channel: 'messages', dm: 'dm_messages' };

function getLinkPreview(url) {
  const row = db.prepare('SELECT data, fetched_at AS fetchedAt, ok FROM link_previews WHERE url = ?').get(url);
  if (!row) return null;
  return { card: row.ok && row.data ? JSON.parse(row.data) : null, fetchedAt: row.fetchedAt, ok: !!row.ok };
}

// Cache a card (or a failure, card = null) for a URL.
function saveLinkPreview(url, card) {
  db.prepare(`INSERT INTO link_previews(url, data, fetched_at, ok) VALUES (?, ?, ?, ?)
    ON CONFLICT(url) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at, ok = excluded.ok`)
    .run(url, card ? JSON.stringify(card) : null, Date.now(), card ? 1 : 0);
}

function messageExists(kind, messageId) {
  return !!db.prepare(`SELECT 1 FROM ${MESSAGE_TABLE[kind]} WHERE id = ?`).get(messageId);
}

// Replace the list of URLs whose cards a message shows.
const setEmbeds = db.transaction((kind, messageId, urls) => {
  const table = EMBED_TABLE[kind];
  db.prepare(`DELETE FROM ${table} WHERE message_id = ?`).run(messageId);
  const insert = db.prepare(`INSERT OR IGNORE INTO ${table}(message_id, url, position) VALUES (?, ?, ?)`);
  urls.forEach((url, i) => insert.run(messageId, url, i));
});

// Remove a message's link cards for good (P3-20c): they're cleared now, and
// the flag keeps an edit from bringing them back.
const hideEmbeds = db.transaction((kind, messageId) => {
  db.prepare(`DELETE FROM ${EMBED_TABLE[kind]} WHERE message_id = ?`).run(messageId);
  return db.prepare(`UPDATE ${MESSAGE_TABLE[kind]} SET embeds_hidden = 1 WHERE id = ?`).run(messageId).changes > 0;
});
function embedsHidden(kind, messageId) {
  return !!db.prepare(`SELECT embeds_hidden AS h FROM ${MESSAGE_TABLE[kind]} WHERE id = ?`).get(messageId)?.h;
}

function getEmbedUrls(kind, messageId) {
  return db.prepare(`SELECT url FROM ${EMBED_TABLE[kind]} WHERE message_id = ? ORDER BY position`).all(messageId).map((r) => r.url);
}

// Attach `embeds` (card objects, in order) to each message.
function attachEmbeds(kind, messages) {
  if (!messages.length) return messages;
  const ids = messages.map((m) => m.id);
  const rows = db.prepare(`
    SELECT e.message_id AS messageId, p.data
    FROM ${EMBED_TABLE[kind]} e
    JOIN link_previews p ON p.url = e.url AND p.ok = 1
    WHERE e.message_id IN (${ids.map(() => '?').join(',')})
    ORDER BY e.message_id, e.position
  `).all(...ids);
  const byMsg = new Map();
  for (const r of rows) {
    if (!byMsg.has(r.messageId)) byMsg.set(r.messageId, []);
    byMsg.get(r.messageId).push(JSON.parse(r.data));
  }
  for (const m of messages) m.embeds = byMsg.get(m.id) || [];
  return messages;
}

// ---- Reactions ----

// Attach an aggregated `reactions` array to each message: [{ emoji, count, users }].
function attachReactions(messages) {
  if (!messages.length) return messages;
  const ids = messages.map((m) => m.id);
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT r.message_id AS messageId, r.emoji, u.username
    FROM reactions r
    JOIN users u ON r.user_id = u.id
    WHERE r.message_id IN (${placeholders})
    ORDER BY r.rowid
  `).all(...ids);
  const byMsg = new Map();
  for (const row of rows) {
    let emojis = byMsg.get(row.messageId);
    if (!emojis) { emojis = new Map(); byMsg.set(row.messageId, emojis); }
    let entry = emojis.get(row.emoji);
    if (!entry) { entry = { emoji: row.emoji, count: 0, users: [] }; emojis.set(row.emoji, entry); }
    entry.count += 1;
    entry.users.push(row.username);
  }
  for (const msg of messages) {
    const emojis = byMsg.get(msg.id);
    msg.reactions = emojis ? Array.from(emojis.values()) : [];
  }
  return messages;
}

// Add the reaction if the user hasn't used this emoji here, otherwise remove it.
function toggleReaction(messageId, userId, emoji) {
  const existing = db.prepare('SELECT 1 FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?')
    .get(messageId, userId, emoji);
  if (existing) {
    db.prepare('DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?')
      .run(messageId, userId, emoji);
    return { added: false };
  }
  db.prepare('INSERT INTO reactions(message_id, user_id, emoji) VALUES (?, ?, ?)')
    .run(messageId, userId, emoji);
  return { added: true };
}

function getReaction(messageId, emoji) {
  const rows = db.prepare(`
    SELECT u.username FROM reactions r
    JOIN users u ON r.user_id = u.id
    WHERE r.message_id = ? AND r.emoji = ?
  `).all(messageId, emoji);
  return { count: rows.length, users: rows.map((r) => r.username) };
}

function isMessageInChannel(messageId, spaceName, channelName) {
  return !!db.prepare(`
    SELECT 1 FROM messages m
    JOIN channels c ON m.channel_id = c.id
    JOIN spaces s ON c.space_id = s.id
    WHERE m.id = ? AND s.name = ? AND c.name = ?
  `).get(messageId, spaceName, channelName);
}

// Where a message lives — { space, channel } — used to route edit/delete/react
// events from the single gateway socket to the right server's members.
// ---- Pins ----
const MAX_PINS_PER_CHANNEL = 50;

// Pin a channel message. Returns 'pinned' | 'already' | 'full' | 'missing'.
const pinMessage = db.transaction((messageId, userId) => {
  const msg = db.prepare('SELECT channel_id AS channelId FROM messages WHERE id = ?').get(messageId);
  if (!msg) return 'missing';
  if (db.prepare('SELECT 1 FROM pins WHERE message_id = ?').get(messageId)) return 'already';
  const count = db.prepare('SELECT COUNT(*) AS n FROM pins WHERE channel_id = ?').get(msg.channelId).n;
  if (count >= MAX_PINS_PER_CHANNEL) return 'full';
  db.prepare('INSERT INTO pins(message_id, channel_id, pinned_by, pinned_at) VALUES (?, ?, ?, ?)').run(messageId, msg.channelId, userId, Date.now());
  return 'pinned';
});

function unpinMessage(messageId) {
  return db.prepare('DELETE FROM pins WHERE message_id = ?').run(messageId).changes > 0;
}

// A channel's pinned messages, most recently pinned first, each with who
// pinned it and when.
function getPins(spaceName, channelName) {
  const rows = db.prepare(`
    SELECT x.*, pin.pinned_at AS pinnedAt, pb.username AS pinnedBy
    FROM (${MESSAGE_SELECT} WHERE s.name = ? AND c.name = ?) x
    JOIN pins pin ON pin.message_id = x.id
    LEFT JOIN users pb ON pb.id = pin.pinned_by
    ORDER BY pin.pinned_at DESC, pin.message_id DESC
  `).all(spaceName, channelName);
  return attachEmbeds('channel', attachReactions(rows.map(hydrateMessage)));
}

// ---- Threads ----
// A thread is a hidden channel named ~t<root message id> under a text channel.
const isThreadChannel = (name) => typeof name === 'string' && name.startsWith('~t');

// "First 40 characters" of the root message, cut at 39 plus an ellipsis.
function defaultThreadName(content) {
  const text = replySnippet(content, false);
  if (!text) return 'Thread';
  return text.length > 40 ? `${text.slice(0, 39).trimEnd()}…` : text;
}

const THREAD_SELECT = `
  SELECT t.id, t.name AS channel, t.thread_name AS name, t.root_message_id AS rootMessageId,
         pc.name AS parentChannel, t.last_activity_at AS lastActivityAt, t.archived_at AS archivedAt,
         cu.username AS createdBy,
         (SELECT COUNT(*) FROM messages tm WHERE tm.channel_id = t.id) AS messageCount
  FROM channels t
  JOIN channels pc ON pc.id = t.parent_id
  JOIN spaces s ON s.id = t.space_id
  LEFT JOIN users cu ON cu.id = t.created_by
  WHERE t.type = 'thread'`;
function shapeThread(row) {
  if (!row) return null;
  const { archivedAt, ...t } = row;
  return { ...t, archived: archivedAt != null };
}

function getThread(spaceName, channelName) {
  return shapeThread(db.prepare(`${THREAD_SELECT} AND s.name = ? AND t.name = ?`).get(spaceName, channelName));
}

// A channel's threads, newest activity first; archived ones only if asked.
// With `userId`, each says whether that user follows it.
function getThreads(spaceName, parentName, archived = false, userId = null) {
  const rows = db.prepare(`${THREAD_SELECT} AND s.name = ? AND pc.name = ? AND (t.archived_at IS NOT NULL) = ?
    ORDER BY t.last_activity_at DESC, t.id DESC`)
    .all(spaceName, parentName, archived ? 1 : 0).map(shapeThread);
  return userId == null ? rows : rows.map((t) => ({ ...t, followed: isFollowingThread(userId, t.id) }));
}

// Archive (or reopen) a thread by hand. Returns whether it changed.
function setThreadArchived(spaceName, channelName, archived) {
  return db.prepare(`
    UPDATE channels SET archived_at = ?
    WHERE id = (SELECT c.id FROM channels c JOIN spaces s ON c.space_id = s.id WHERE s.name = ? AND c.name = ? AND c.type = 'thread')
      AND (archived_at IS NULL) = ?
  `).run(archived ? Date.now() : null, spaceName, channelName, archived ? 1 : 0).changes > 0;
}

// Archive every open thread with no activity since `before`. Returns the
// archived threads, each with its `space`, so viewers can be told.
function archiveQuietThreads(before, now = Date.now()) {
  const rows = db.prepare(`
    SELECT t.id, s.name AS space, t.name AS channel FROM channels t JOIN spaces s ON s.id = t.space_id
    WHERE t.type = 'thread' AND t.archived_at IS NULL AND COALESCE(t.last_activity_at, 0) < ?
  `).all(before);
  if (!rows.length) return [];
  db.prepare(`UPDATE channels SET archived_at = ? WHERE id IN (${rows.map(() => '?').join(',')})`).run(now, ...rows.map((r) => r.id));
  return rows.map((r) => ({ space: r.space, ...getThread(r.space, r.channel) }));
}

// Start a thread from a message in `parentName` (or return the one it has).
// Returns { thread, created } or { error: 'not_found' | 'bad_name' }.
const createThread = db.transaction((spaceName, parentName, messageId, name, userId) => {
  const parent = db.prepare(`
    SELECT c.id, c.space_id AS spaceId, c.view_role AS view, c.post_role AS post
    FROM channels c JOIN spaces s ON c.space_id = s.id
    WHERE s.name = ? AND c.name = ? AND c.type = 'text'
  `).get(spaceName, parentName);
  const root = parent && db.prepare('SELECT id, content FROM messages WHERE id = ? AND channel_id = ?').get(messageId, parent.id);
  if (!root) return { error: 'not_found' };
  const existing = db.prepare(`${THREAD_SELECT} AND t.root_message_id = ?`).get(root.id);
  if (existing) return { thread: shapeThread(existing), created: false };
  const title = typeof name === 'string' && name.trim() ? name.trim() : defaultThreadName(root.content);
  if (title.length > 80) return { error: 'bad_name' };
  const channel = `~t${root.id}`;
  db.prepare(`
    INSERT INTO channels(space_id, name, type, view_role, post_role, parent_id, root_message_id, thread_name, created_by, last_activity_at)
    VALUES (?, ?, 'thread', ?, ?, ?, ?, ?, ?, ?)
  `).run(parent.spaceId, channel, parent.view, parent.post, parent.id, root.id, title, userId, Date.now());
  const thread = getThread(spaceName, channel);
  followThread(userId, thread.id); // you follow what you start
  return { thread, created: true };
});

function getMessageLocation(messageId) {
  return db.prepare(`
    SELECT s.name AS space, c.name AS channel, m.author_id AS authorId, m.content
    FROM messages m
    JOIN channels c ON m.channel_id = c.id
    JOIN spaces s ON c.space_id = s.id
    WHERE m.id = ?
  `).get(messageId);
}

// ---- Unread / read state ----

// Advance the user's read marker for a channel (never moves backwards).
function markRead(userId, space, channel, lastReadId) {
  db.prepare(`
    INSERT INTO read_state(user_id, space, channel, last_read_id)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, space, channel)
    DO UPDATE SET last_read_id = MAX(last_read_id, excluded.last_read_id)
  `).run(userId, space, channel, lastReadId || 0);
}

// Unread message counts per channel across all of the user's servers
// (only channels the user is allowed to view). Threads count only when the
// user follows them; a thread row names its `parent` channel.
function getUnreadCounts(userId) {
  const visible = visibleChannelIds(userId);
  return db.prepare(`
    SELECT s.name AS space, c.name AS channel, pc.name AS parent, COUNT(m.id) AS count,
      COALESCE(rs.last_read_id, 0) AS lastReadId
    FROM space_members sm
    JOIN spaces s ON sm.space_id = s.id
    JOIN channels c ON c.space_id = s.id AND c.id IN ${inList(visible)}
    LEFT JOIN channels pc ON pc.id = c.parent_id
    LEFT JOIN thread_follows tf ON tf.channel_id = c.id AND tf.user_id = sm.user_id
    LEFT JOIN read_state rs ON rs.user_id = sm.user_id AND rs.space = s.name AND rs.channel = c.name
    LEFT JOIN messages m ON m.channel_id = c.id AND m.id > COALESCE(rs.last_read_id, 0)
    WHERE sm.user_id = ? AND (c.type IS NOT 'thread' OR tf.user_id IS NOT NULL)
    GROUP BY s.name, c.name, pc.name
    HAVING count > 0
  `).all(...visible, userId).map(withParent);
}
// Only thread rows name a parent channel.
const withParent = ({ parent, ...row }) => (parent ? { ...row, parent } : row);

// Record which server members a message mentions (only real members count).
// Returns the resolved usernames so the sender's client can highlight them.
// `ids` (optional) collects the mentioned users' ids. P9-07a: someone who has
// blocked `authorId` isn't mentioned (no row, no badge, no push).
function addMentions(messageId, spaceId, usernames, ids = [], authorId = null) {
  if (!usernames.length) return [];
  const memberByName = db.prepare(
    'SELECT u.id, u.username FROM users u JOIN space_members sm ON sm.user_id = u.id WHERE sm.space_id = ? AND u.username = ? COLLATE NOCASE'
  );
  const insert = db.prepare('INSERT OR IGNORE INTO mentions(message_id, user_id) VALUES (?, ?)');
  const resolved = [];
  for (const name of usernames) {
    const row = memberByName.get(spaceId, name);
    if (row && authorId && isBlocked(row.id, authorId)) continue;
    if (row && !ids.includes(row.id)) { // `@Sandy @sandy` is one mention (P11-12)
      insert.run(messageId, row.id);
      resolved.push(row.username);
      ids.push(row.id);
    }
  }
  return resolved;
}

// Unread mentions of the user, per channel (mentions in messages newer than the
// user's read marker for that channel). Mentions in any thread the user can
// see count, followed or not; a thread row names its `parent` channel.
function getMentionCounts(userId) {
  const visible = visibleChannelIds(userId);
  return db.prepare(`
    SELECT s.name AS space, c.name AS channel, pc.name AS parent, COUNT(m.id) AS count
    FROM mentions mn
    JOIN messages m ON mn.message_id = m.id
    JOIN channels c ON m.channel_id = c.id AND c.id IN ${inList(visible)}
    JOIN spaces s ON c.space_id = s.id
    JOIN space_members sm ON sm.space_id = s.id AND sm.user_id = mn.user_id
    LEFT JOIN channels pc ON pc.id = c.parent_id
    LEFT JOIN read_state rs ON rs.user_id = ? AND rs.space = s.name AND rs.channel = c.name
    WHERE mn.user_id = ? AND m.id > COALESCE(rs.last_read_id, 0)
    GROUP BY s.name, c.name, pc.name
    HAVING count > 0
  `).all(...visible, userId, userId).map(withParent);
}

// ---- Web Push subscriptions (P2-18b) ----
const MAX_PUSH_SUBSCRIPTIONS = 10;
function getPushSubscriptions(userId) {
  return db.prepare('SELECT id, endpoint, p256dh, auth, previews FROM push_subscriptions WHERE user_id = ? ORDER BY id').all(userId);
}
// Save a browser's subscription (an endpoint already saved moves to this
// user and takes the new keys and preview choice).
function savePushSubscription(userId, subscription, previews = true) {
  db.prepare(`
    INSERT INTO push_subscriptions(user_id, endpoint, p256dh, auth, previews, created_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, previews = excluded.previews
  `).run(userId, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, previews ? 1 : 0, Date.now());
  // P11-10: at most MAX_PUSH_SUBSCRIPTIONS per person; the oldest go first.
  db.prepare(`
    DELETE FROM push_subscriptions WHERE user_id = ? AND id NOT IN (
      SELECT id FROM push_subscriptions WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?
    )
  `).run(userId, userId, MAX_PUSH_SUBSCRIPTIONS);
}
function deletePushSubscription(userId, endpoint) {
  return db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').run(userId, endpoint).changes > 0;
}
function deletePushEndpoint(endpoint) {
  return db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint).changes > 0;
}

// ---- Thread follows ----
// The channel id of a thread (null if that name isn't a thread here).
function threadChannelId(spaceName, channelName) {
  const row = db.prepare(`
    SELECT c.id FROM channels c JOIN spaces s ON c.space_id = s.id
    WHERE s.name = ? AND c.name = ? AND c.type = 'thread'
  `).get(spaceName, channelName);
  return row ? row.id : null;
}
// Both return whether anything changed.
function followThread(userId, channelId) {
  return db.prepare('INSERT OR IGNORE INTO thread_follows(user_id, channel_id, followed_at) VALUES (?, ?, ?)')
    .run(userId, channelId, Date.now()).changes > 0;
}
function unfollowThread(userId, channelId) {
  return db.prepare('DELETE FROM thread_follows WHERE user_id = ? AND channel_id = ?').run(userId, channelId).changes > 0;
}
function isFollowingThread(userId, channelId) {
  return !!db.prepare('SELECT 1 FROM thread_follows WHERE user_id = ? AND channel_id = ?').get(userId, channelId);
}
// Every thread the user follows: { space, channel, parent, name }.
function getThreadFollows(userId) {
  return db.prepare(`
    SELECT s.name AS space, t.name AS channel, pc.name AS parent, t.thread_name AS name
    FROM thread_follows tf
    JOIN channels t ON t.id = tf.channel_id
    JOIN channels pc ON pc.id = t.parent_id
    JOIN spaces s ON s.id = t.space_id
    WHERE tf.user_id = ?
    ORDER BY t.id
  `).all(userId);
}

// Mark every channel of a server read up to its latest message (used on join so
// a new member starts with a clean slate rather than a wall of "unread").
function markSpaceRead(userId, spaceName) {
  db.prepare(`
    INSERT INTO read_state(user_id, space, channel, last_read_id)
    SELECT ?, s.name, c.name, COALESCE(MAX(m.id), 0)
    FROM channels c
    JOIN spaces s ON c.space_id = s.id
    LEFT JOIN messages m ON m.channel_id = c.id
    WHERE s.name = ?
    GROUP BY c.id
    ON CONFLICT(user_id, space, channel)
    DO UPDATE SET last_read_id = MAX(last_read_id, excluded.last_read_id)
  `).run(userId, spaceName);
}

// ---- Direct messages ----
// P9-06a: a DM belongs to a conversation. Today's are pairs (one per two
// people, found by pair_key "a:b"); groups come in P9-06c. The pair-based
// functions below (storeDm(fromId, toId), getDmMessages(userId, otherId)…)
// still work and resolve the pair first.
function dmPair(a, b) {
  return a < b ? [a, b] : [b, a];
}
const pairKey = (a, b) => dmPair(a, b).join(':');

// The pair conversation of two people, or null if they've never talked.
function findPair(a, b) {
  return db.prepare('SELECT id FROM dm_conversations WHERE pair_key = ?').get(pairKey(a, b))?.id ?? null;
}
// …or made now (on their first message).
const getOrCreatePair = db.transaction((a, b) => {
  const found = findPair(a, b);
  if (found) return found;
  const now = Date.now();
  const id = Number(db.prepare("INSERT INTO dm_conversations(kind, created_at, pair_key) VALUES ('pair', ?, ?)").run(now, pairKey(a, b)).lastInsertRowid);
  const add = db.prepare('INSERT OR IGNORE INTO dm_participants(conversation_id, user_id, joined_at) VALUES (?, ?, ?)');
  add.run(id, a, now);
  add.run(id, b, now);
  return id;
});
function getConversation(id) {
  return db.prepare('SELECT id, kind, name, owner_id AS ownerId, created_at AS createdAt FROM dm_conversations WHERE id = ?').get(id) || null;
}
function participantsOf(id) {
  return db.prepare('SELECT user_id AS userId, joined_at AS joinedAt, muted, last_read_id AS lastReadId FROM dm_participants WHERE conversation_id = ? ORDER BY joined_at, user_id').all(id);
}
const participantIds = (id) => participantsOf(id).map((p) => p.userId);
function isParticipant(id, userId) {
  return !!db.prepare('SELECT 1 FROM dm_participants WHERE conversation_id = ? AND user_id = ?').get(id, userId);
}
// The other person in a pair (for the username-keyed app and frames).
function pairPartner(id, userId) {
  return db.prepare(`
    SELECT u.id, u.username, u.avatar_url AS avatar FROM dm_participants p JOIN users u ON u.id = p.user_id
    WHERE p.conversation_id = ? AND p.user_id != ?
  `).get(id, userId) || null;
}

const DM_SELECT = `
  SELECT m.id,
         m.content,
         m.attachment_url AS attachment,
         m.attachments AS attachments,
         m.attachment_spoiler AS spoiler,
         COALESCE(m.created_at, 0) AS timestamp,
         m.edited_at AS editedAt,
         m.author_id AS authorId,
         u.username AS author,
         u.avatar_url AS authorAvatar,
         m.reply_to AS replyToId,
         p.id AS replyFoundId,
         p.content AS replyContent,
         p.attachment_url AS replyAttachment,
         p.attachments AS replyAttachments,
         p.author_id AS replyAuthorId,
         pu.username AS replyAuthor,
         m.kind AS kind
  FROM dm_messages m
  JOIN users u ON m.author_id = u.id
  LEFT JOIN dm_messages p ON p.id = m.reply_to
  LEFT JOIN users pu ON pu.id = p.author_id
`;

// A new DM in a conversation. user_a / user_b (NOT NULL, from before
// conversations) hold the pair, or the author twice in a group. `kind`
// 'system' (P9-06c) is a notice like "sandy added bob".
function storeConversationDm(conversationId, authorId, content, attachments = [], spoiler = false, replyTo = null, kind = null) {
  const conv = getConversation(conversationId);
  const [a, b] = conv && conv.kind === 'pair' ? dmPair(...participantIds(conversationId)) : [authorId, authorId];
  const list = Array.isArray(attachments) ? attachments : (attachments ? [attachments] : []);
  const first = list[0] || null;
  const json = list.length ? JSON.stringify(list) : null;
  const createdAt = Date.now();
  const info = db.prepare(
    'INSERT INTO dm_messages(conversation_id, user_a, user_b, author_id, content, attachment_url, attachments, attachment_spoiler, created_at, reply_to, kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(conversationId, a, b ?? a, authorId, content, first, json, spoiler ? 1 : 0, createdAt, replyTo || null, kind);
  return { id: info.lastInsertRowid, timestamp: createdAt };
}
function storeDm(fromId, toId, content, attachments = [], spoiler = false, replyTo = null) {
  return storeConversationDm(getOrCreatePair(fromId, toId), fromId, content, attachments, spoiler, replyTo);
}

// A DM row as the app gets it; `kind` only on notices (P9-06c).
function hydrateDm(row) {
  const m = hydrateMessage(row);
  if (m.kind == null) delete m.kind;
  return m;
}

// ---- Reading a conversation (by id) ----
function getConversationMessages(conversationId, limit = 50, offset = 0) {
  return attachEmbeds('dm', db.prepare(`${DM_SELECT} WHERE m.conversation_id = ? ORDER BY m.id DESC LIMIT ? OFFSET ?`)
    .all(conversationId, limit, offset).reverse().map(hydrateDm));
}
// The quote for a new DM reply, if `messageId` is in this same conversation
// (so a reply can never reveal someone else's messages).
function getConversationReplyTarget(conversationId, messageId) {
  const row = db.prepare(`${DM_SELECT} WHERE m.conversation_id = ? AND m.id = ? AND m.kind IS NULL`).get(conversationId, messageId); // not a notice
  if (!row) return null;
  return {
    id: row.id,
    authorId: row.authorId,
    author: row.author || 'Unknown',
    snippet: replySnippet(row.content, !!(row.attachment || row.attachments)),
  };
}
// A window of a conversation around one message (see getMessagesAround).
function getConversationMessagesAround(conversationId, messageId, half = 25) {
  const where = 'WHERE m.conversation_id = ?';
  if (!db.prepare(`${DM_SELECT} ${where} AND m.id = ?`).get(conversationId, messageId)) return null;
  const before = db.prepare(`${DM_SELECT} ${where} AND m.id < ? ORDER BY m.id DESC LIMIT ?`).all(conversationId, messageId, half).reverse();
  const from = db.prepare(`${DM_SELECT} ${where} AND m.id >= ? ORDER BY m.id ASC LIMIT ?`).all(conversationId, messageId, half + 1);
  return attachEmbeds('dm', [...before, ...from].map(hydrateDm));
}
// The page just older than `beforeId`, oldest-first.
function getConversationMessagesBefore(conversationId, beforeId, limit = 50) {
  return attachEmbeds('dm', db.prepare(`${DM_SELECT} WHERE m.conversation_id = ? AND m.id < ? ORDER BY m.id DESC LIMIT ?`)
    .all(conversationId, beforeId, limit).reverse().map(hydrateDm));
}
function getConversationMessagesAfter(conversationId, afterId, limit = 200) {
  return attachEmbeds('dm', db.prepare(`${DM_SELECT} WHERE m.conversation_id = ? AND m.id > ? ORDER BY m.id ASC LIMIT ?`)
    .all(conversationId, afterId, limit).map(hydrateDm));
}

// ---- The same, by the two people (the username-keyed paths) ----
function getDmMessages(userId, otherId, limit = 50, offset = 0) {
  const c = findPair(userId, otherId);
  return c ? getConversationMessages(c, limit, offset) : [];
}
function getDmReplyTarget(userId, otherId, messageId) {
  const c = findPair(userId, otherId);
  return c ? getConversationReplyTarget(c, messageId) : null;
}
function getDmMessagesAround(userId, otherId, messageId, half = 25) {
  const c = findPair(userId, otherId);
  return c ? getConversationMessagesAround(c, messageId, half) : null;
}
function getDmMessagesBefore(userId, otherId, beforeId, limit = 50) {
  const c = findPair(userId, otherId);
  return c ? getConversationMessagesBefore(c, beforeId, limit) : [];
}
function getDmMessagesAfter(userId, otherId, afterId, limit = 200) {
  const c = findPair(userId, otherId);
  return c ? getConversationMessagesAfter(c, afterId, limit) : [];
}

// A DM's conversation and author (and, for pairs, its two people), so its
// changes reach everyone in the conversation.
function getDmById(messageId) {
  return db.prepare('SELECT id, conversation_id AS conversationId, user_a, user_b, author_id, kind FROM dm_messages WHERE id = ?').get(messageId) || null;
}

// Edit/delete a DM, but only if the requester is its author.
const editDm = db.transaction((messageId, authorId, content) => {
  const old = db.prepare('SELECT content, COALESCE(edited_at, created_at) AS writtenAt FROM dm_messages WHERE id = ? AND author_id = ? AND kind IS NULL').get(messageId, authorId);
  if (!old) return null;
  const editedAt = Date.now();
  // P3-27: keep the old text as a version, unless nothing changed.
  if (old.content !== content) {
    db.prepare('INSERT INTO dm_message_versions(message_id, content, written_at) VALUES (?, ?, ?)').run(messageId, old.content ?? '', old.writtenAt);
  }
  db.prepare('UPDATE dm_messages SET content = ?, edited_at = ? WHERE id = ?').run(content, editedAt, messageId);
  return editedAt;
});

function deleteDm(messageId, authorId) {
  return db.prepare('DELETE FROM dm_messages WHERE id = ? AND author_id = ? AND kind IS NULL')
    .run(messageId, authorId).changes > 0;
}

// My conversations, newest first: { id, kind, name, ownerId, muted, members
// [{ id, username, avatar }] (everyone, me too), unread, and the last
// message }. A pair also gives the other person's `username` and `avatar`
// (what the app keyed DMs by before P9-06b). Pairs show once they have a
// message; groups (P9-06c) from the start.
function getDmConversations(userId, { only = null } = {}) {
  const rows = db.prepare(`
    SELECT c.id, c.kind, c.name, c.owner_id AS ownerId, me.muted,
           last.content AS lastContent, last.attachment_url AS lastAttachment, last.created_at AS lastTimestamp,
           last.author_id AS lastAuthorId, last.kind AS lastKind,
           (SELECT COUNT(*) FROM dm_messages um WHERE um.conversation_id = c.id AND um.author_id != me.user_id AND um.id > me.last_read_id) AS unread
    FROM dm_participants me
    JOIN dm_conversations c ON c.id = me.conversation_id
    LEFT JOIN dm_messages last ON last.id = (SELECT MAX(id) FROM dm_messages WHERE conversation_id = c.id)
    WHERE me.user_id = ? AND (last.id IS NOT NULL OR c.kind != 'pair' OR c.id = ?) AND (? IS NULL OR c.id = ?)
    ORDER BY COALESCE(last.id, 0) DESC, c.created_at DESC
  `).all(userId, only, only, only);
  const members = db.prepare(`
    SELECT u.id, u.username, u.avatar_url AS avatar FROM dm_participants p JOIN users u ON u.id = p.user_id
    WHERE p.conversation_id = ? ORDER BY p.joined_at, p.user_id
  `);
  return rows.map((r) => {
    const list = members.all(r.id);
    const other = r.kind === 'pair' ? list.find((m) => m.id !== userId) : null;
    return {
      id: r.id, kind: r.kind, name: r.name || null, ownerId: r.ownerId ?? null, muted: !!r.muted, members: list,
      ...(other ? { username: other.username, avatar: other.avatar, blocked: eitherBlocked(userId, other.id) } : {}), // P9-07a
      lastContent: r.lastContent, lastAttachment: r.lastAttachment, lastTimestamp: r.lastTimestamp, unread: r.unread,
      // P10-04: who sent the last message (a group's preview names them), and whether it was a notice.
      lastAuthorId: r.lastAuthorId ?? null, lastKind: r.lastKind || null,
    };
  }).filter((c) => c.kind !== 'pair' || c.username); // a pair whose other person is gone
}

// ---- Group DMs (P9-06c) ----
// Who may be added: someone you share a server with, or a friend.
// ---- Who can DM me (P11-09) ----
const DM_POLICIES = ['friends_and_servers', 'everyone'];
function getDmPolicy(userId) {
  const row = db.prepare('SELECT dm_policy FROM users WHERE id = ?').get(userId);
  return row && DM_POLICIES.includes(row.dm_policy) ? row.dm_policy : 'friends_and_servers';
}
function setDmPolicy(userId, policy) {
  db.prepare('UPDATE users SET dm_policy = ? WHERE id = ?').run(policy, userId);
}
// May `fromId` start a conversation with `toId`, or add them to a group?
// Friends and people sharing a server always; anyone if `toId` allows it.
function canStartDm(fromId, toId) {
  return canAddToGroup(fromId, toId) || getDmPolicy(toId) === 'everyone';
}
function canAddToGroup(adderId, userId) {
  return !!db.prepare(`
    SELECT 1 FROM space_members a JOIN space_members b ON a.space_id = b.space_id WHERE a.user_id = ? AND b.user_id = ?
    UNION SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ?
  `).get(adderId, userId, adderId, userId);
}
// A new group: the owner first (earliest joined), then the others.
const createGroup = db.transaction((ownerId, memberIds, name = null) => {
  const now = Date.now();
  const id = Number(db.prepare("INSERT INTO dm_conversations(kind, name, owner_id, created_at) VALUES ('group', ?, ?, ?)").run(name || null, ownerId, now).lastInsertRowid);
  const add = db.prepare('INSERT OR IGNORE INTO dm_participants(conversation_id, user_id, joined_at) VALUES (?, ?, ?)');
  add.run(id, ownerId, now);
  memberIds.forEach((m, i) => add.run(id, m, now + 1 + i));
  return id;
});
function addParticipants(conversationId, userIds) {
  const now = Date.now();
  const add = db.prepare('INSERT OR IGNORE INTO dm_participants(conversation_id, user_id, joined_at) VALUES (?, ?, ?)');
  db.transaction(() => userIds.forEach((u, i) => add.run(conversationId, u, now + i)))();
}
// Someone leaves (or is removed). Returns what's left: { gone } when nobody
// is, else { newOwner } when the owner left (the earliest-joined takes over).
const leaveConversation = db.transaction((conversationId, userId) => {
  db.prepare('DELETE FROM dm_participants WHERE conversation_id = ? AND user_id = ?').run(conversationId, userId);
  const left = participantsOf(conversationId);
  if (!left.length) {
    db.prepare('DELETE FROM dm_messages WHERE conversation_id = ?').run(conversationId);
    db.prepare('DELETE FROM dm_conversations WHERE id = ?').run(conversationId);
    return { gone: true };
  }
  const conv = getConversation(conversationId);
  if (conv.ownerId === userId) {
    db.prepare('UPDATE dm_conversations SET owner_id = ? WHERE id = ?').run(left[0].userId, conversationId);
    return { newOwner: left[0].userId };
  }
  return {};
});
function renameConversation(conversationId, name) {
  db.prepare('UPDATE dm_conversations SET name = ? WHERE id = ?').run(name || null, conversationId);
}
function setConversationMuted(conversationId, userId, muted) {
  db.prepare('UPDATE dm_participants SET muted = ? WHERE conversation_id = ? AND user_id = ?').run(muted ? 1 : 0, conversationId, userId);
}
// One conversation as GET /dms lists it, for one of its people (or null).
function getConversationSummary(conversationId, userId) {
  return getDmConversations(userId, { only: conversationId })[0] || null;
}

function markConversationRead(userId, conversationId, lastReadId) {
  db.prepare('UPDATE dm_participants SET last_read_id = MAX(last_read_id, ?) WHERE conversation_id = ? AND user_id = ?')
    .run(lastReadId || 0, conversationId, userId);
}
function markDmRead(userId, otherId, lastReadId) {
  const c = findPair(userId, otherId);
  if (c) markConversationRead(userId, c, lastReadId);
}

// Unread DM counts per conversation (only others' messages count), with the
// other person's username for pairs (`other`, as before P9-06a).
function getDmUnreadCounts(userId) {
  return db.prepare(`
    SELECT me.conversation_id AS conversation, COUNT(m.id) AS count,
           CASE WHEN c.kind = 'pair' THEN (SELECT u.username FROM dm_participants o JOIN users u ON u.id = o.user_id
                                            WHERE o.conversation_id = c.id AND o.user_id != me.user_id) END AS other
    FROM dm_participants me
    JOIN dm_conversations c ON c.id = me.conversation_id
    JOIN dm_messages m ON m.conversation_id = me.conversation_id AND m.author_id != me.user_id AND m.id > me.last_read_id
    WHERE me.user_id = ?
    GROUP BY me.conversation_id
    HAVING count > 0
  `).all(userId);
}

// Full-text-ish search over messages the user can see: channel messages in
// their servers, plus their direct messages. Returns two lists.
function searchMessages(userId, query, limit = 40) {
  const like = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
  const visible = visibleChannelIds(userId);
  const channels = db.prepare(`
    SELECT m.id, m.content,
           COALESCE(m.created_at, CAST(strftime('%s', m.timestamp) AS INTEGER) * 1000) AS timestamp,
           u.username AS author, u.avatar_url AS authorAvatar,
           s.name AS space, c.name AS channel, c.thread_name AS threadName, pc.name AS parentChannel
    FROM messages m
    JOIN channels c ON m.channel_id = c.id AND c.id IN ${inList(visible)}
    JOIN spaces s ON c.space_id = s.id
    JOIN space_members sm ON sm.space_id = s.id AND sm.user_id = ?
    LEFT JOIN channels pc ON pc.id = c.parent_id
    LEFT JOIN users u ON m.author_id = u.id
    WHERE m.content LIKE ? ESCAPE '\\'
    ORDER BY m.id DESC
    LIMIT ?
  `).all(...visible, userId, like, limit).map(({ threadName, parentChannel, ...r }) => ({
    ...r,
    thread: parentChannel ? { channel: r.channel, name: threadName, parentChannel } : null,
  }));

  // P9-06a: the conversations I'm in; `dmWith` names the other person in a pair.
  const dms = db.prepare(`
    SELECT m.id, m.content, COALESCE(m.created_at, 0) AS timestamp,
           u.username AS author, u.avatar_url AS authorAvatar,
           m.conversation_id AS conversationId,
           CASE WHEN c.kind = 'pair' THEN (SELECT pu.username FROM dm_participants o JOIN users pu ON pu.id = o.user_id
                                            WHERE o.conversation_id = c.id AND o.user_id != me.user_id) END AS dmWith
    FROM dm_messages m
    JOIN dm_participants me ON me.conversation_id = m.conversation_id AND me.user_id = ?
    JOIN dm_conversations c ON c.id = m.conversation_id
    JOIN users u ON m.author_id = u.id
    WHERE m.kind IS NULL AND m.content LIKE ? ESCAPE '\\'
    ORDER BY m.id DESC
    LIMIT ?
  `).all(userId, like, limit);

  return { channels, dms };
}

// Distinct user ids that share at least one server with the given user.
function getCoMemberIds(userId) {
  return db.prepare(`
    SELECT DISTINCT sm2.user_id AS id
    FROM space_members sm1
    JOIN space_members sm2 ON sm1.space_id = sm2.space_id
    WHERE sm1.user_id = ? AND sm2.user_id != ?
  `).all(userId, userId).map((r) => r.id);
}

// Edit a message, but only if the requester is its author. Returns the new
// edited_at timestamp on success, or null if not found / not the author.
// The old text is kept as a version (P3-27), unless nothing changed.
const editMessage = db.transaction((messageId, authorId, content) => {
  const old = db.prepare(`
    SELECT content, COALESCE(edited_at, created_at, CAST(strftime('%s', timestamp) AS INTEGER) * 1000) AS writtenAt
    FROM messages WHERE id = ? AND author_id = ?
  `).get(messageId, authorId);
  if (!old) return null;
  const editedAt = Date.now();
  if (old.content !== content) {
    db.prepare('INSERT INTO message_versions(message_id, content, written_at) VALUES (?, ?, ?)').run(messageId, old.content ?? '', old.writtenAt);
  }
  db.prepare('UPDATE messages SET content = ?, edited_at = ? WHERE id = ?').run(content, editedAt, messageId);
  return editedAt;
});

// A message's earlier texts, oldest first, and its current one (P3-27).
function getMessageVersions(messageId) {
  const current = db.prepare('SELECT content, edited_at AS editedAt FROM messages WHERE id = ?').get(messageId);
  if (!current) return null;
  const versions = db.prepare('SELECT content, written_at AS writtenAt FROM message_versions WHERE message_id = ? ORDER BY id').all(messageId);
  return { versions, current };
}
function getDmVersions(messageId) {
  const current = db.prepare('SELECT content, edited_at AS editedAt FROM dm_messages WHERE id = ?').get(messageId);
  if (!current) return null;
  const versions = db.prepare('SELECT content, written_at AS writtenAt FROM dm_message_versions WHERE message_id = ? ORDER BY id').all(messageId);
  return { versions, current };
}

// Delete a message, but only if the requester is its author.
function deleteMessage(messageId, authorId) {
  return db.prepare('DELETE FROM messages WHERE id = ? AND author_id = ?')
    .run(messageId, authorId).changes > 0;
}

// Unconditional delete; the caller has already checked moderation rights.
function deleteMessageById(messageId) {
  return db.prepare('DELETE FROM messages WHERE id = ?').run(messageId).changes > 0;
}

// ---- Timeouts (P3-26c) ----
// Time someone out until `until` (ms), or clear it with null.
function setMemberTimeout(spaceId, userId, until, reason = null) {
  return db.prepare('UPDATE space_members SET timeout_until = ?, timeout_reason = ? WHERE space_id = ? AND user_id = ?')
    .run(until, until ? reason || null : null, spaceId, userId).changes > 0;
}
// { until, reason } while someone is timed out, else null. An ended timeout
// needs no clean-up: it just stops counting.
function getMemberTimeout(spaceId, userId, now = Date.now()) {
  const row = db.prepare('SELECT timeout_until AS until, timeout_reason AS reason FROM space_members WHERE space_id = ? AND user_id = ?').get(spaceId, userId);
  return row && row.until && row.until > now ? { until: row.until, reason: row.reason || null } : null;
}
// userId -> until, for everyone timed out in a server right now.
function getTimeoutsMap(spaceId, now = Date.now()) {
  return new Map(db.prepare('SELECT user_id AS userId, timeout_until AS until FROM space_members WHERE space_id = ? AND timeout_until > ?').all(spaceId, now).map((r) => [r.userId, r.until]));
}

// ---- Bans (P3-26b) ----
// Ban someone: they leave the server and no invite lets them back in.
const banMember = db.transaction((spaceId, userId, actorId, reason) => {
  db.prepare(`
    INSERT INTO bans(space_id, user_id, actor_id, reason, created_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(space_id, user_id) DO UPDATE SET actor_id = excluded.actor_id, reason = excluded.reason, created_at = excluded.created_at
  `).run(spaceId, userId, actorId, reason || null, Date.now());
  db.prepare('DELETE FROM member_roles WHERE space_id = ? AND user_id = ?').run(spaceId, userId);
  removeMember(spaceId, userId);
});
function unbanMember(spaceId, userId) {
  return db.prepare('DELETE FROM bans WHERE space_id = ? AND user_id = ?').run(spaceId, userId).changes > 0;
}
function isBanned(spaceId, userId) {
  return !!db.prepare('SELECT 1 FROM bans WHERE space_id = ? AND user_id = ?').get(spaceId, userId);
}
// A server's bans, newest first: [{ username, avatar, by, reason, createdAt }].
function getBans(spaceId) {
  return db.prepare(`
    SELECT u.username, u.avatar_url AS avatar, a.username AS "by", b.reason, b.created_at AS createdAt
    FROM bans b JOIN users u ON u.id = b.user_id LEFT JOIN users a ON a.id = b.actor_id
    WHERE b.space_id = ? ORDER BY b.created_at DESC
  `).all(spaceId);
}
// Someone's messages in a server (threads included) sent since `since` (ms):
// [{ id, channel }], for "delete their messages from the last …".
function memberMessagesSince(spaceId, userId, since) {
  return db.prepare(`
    SELECT m.id, c.name AS channel FROM messages m JOIN channels c ON c.id = m.channel_id
    WHERE c.space_id = ? AND m.author_id = ?
      AND COALESCE(m.created_at, CAST(strftime('%s', m.timestamp) AS INTEGER) * 1000) >= ?
  `).all(spaceId, userId, since);
}

// ---- Message reports (P9-01) ----
const REPORT_PAGE = 50;
const nameOfUser = (id) => (id == null ? null : db.prepare('SELECT username FROM users WHERE id = ?').get(id)?.username ?? null);
// File a report. Returns { id } or { already: true } when this person already
// has an open report on that message.
function createReport(spaceId, { messageId, channel, authorId, reporterId, reason, note, excerpt }) {
  const open = db.prepare("SELECT id FROM reports WHERE message_id = ? AND reporter_id = ? AND status = 'open'").get(messageId, reporterId);
  if (open) return { already: true, id: open.id };
  const info = db.prepare(`
    INSERT INTO reports(space_id, message_id, channel, author_id, author_name, reporter_id, reporter_name, reason, note, excerpt, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(spaceId, messageId, channel, authorId, nameOfUser(authorId), reporterId, nameOfUser(reporterId), reason, note || null, excerpt || '', Date.now());
  return { id: Number(info.lastInsertRowid) };
}
const REPORT_SELECT = `
  SELECT id, message_id AS messageId, channel, author_id AS authorId, author_name AS author, reporter_name AS reporter, reason, note,
    excerpt, status, resolved_by AS resolvedBy, resolution, created_at AS createdAt, resolved_at AS resolvedAt,
    (message_id IS NOT NULL) AS messageExists
  FROM reports`;
const shapeReport = (r) => r && { ...r, messageExists: !!r.messageExists };
// A page of a server's reports, newest first: open ones, or closed ones.
function listReports(spaceId, { status = 'open', before = null, hidden = [] } = {}) {
  const notHidden = hidden.length ? `AND channel NOT IN ${inList(hidden)}` : '';
  const rows = db.prepare(`${REPORT_SELECT} WHERE space_id = ? AND ${status === 'open' ? "status = 'open'" : "status != 'open'"} ${before ? 'AND id < ?' : ''} ${notHidden} ORDER BY id DESC LIMIT ?`)
    .all(...[spaceId, ...(before ? [before] : []), ...hidden, REPORT_PAGE + 1]).map(shapeReport);
  return { reports: rows.slice(0, REPORT_PAGE), more: rows.length > REPORT_PAGE };
}
function getReport(spaceId, id) {
  return shapeReport(db.prepare(`${REPORT_SELECT} WHERE space_id = ? AND id = ?`).get(spaceId, id));
}
// Open reports, counted by message (P10-01): three reports on one message
// are one thing to look at. A deleted message's reports count by author and
// excerpt, the way the queue groups them.
function countOpenReports(spaceId, hidden = []) {
  const notHidden = hidden.length ? `AND channel NOT IN ${inList(hidden)}` : '';
  return db.prepare(`SELECT COUNT(DISTINCT CASE WHEN message_id IS NOT NULL THEN 'm' || message_id ELSE 'x' || author_id || ':' || excerpt END) AS n
    FROM reports WHERE space_id = ? AND status = 'open' ${notHidden}`).get(spaceId, ...hidden).n;
}
// Close a report and every other open report on the same message.
function closeReports(spaceId, report, status, byId, resolution = null) {
  const by = nameOfUser(byId);
  const now = Date.now();
  if (report.messageId != null) {
    return db.prepare("UPDATE reports SET status = ?, resolved_by = ?, resolution = ?, resolved_at = ? WHERE space_id = ? AND status = 'open' AND (id = ? OR message_id = ?)")
      .run(status, by, resolution, now, spaceId, report.id, report.messageId).changes;
  }
  return db.prepare("UPDATE reports SET status = ?, resolved_by = ?, resolution = ?, resolved_at = ? WHERE space_id = ? AND id = ? AND status = 'open'")
    .run(status, by, resolution, now, spaceId, report.id).changes;
}

// ---- Moderation log (P3-26a) ----
const MOD_LOG_PAGE = 50;

// Record a moderator's action. Names are stored as they are now.
function logModAction(spaceId, { actorId, targetId = null, action, reason = null, details = null }) {
  const nameOf = (id) => (id == null ? null : db.prepare('SELECT username FROM users WHERE id = ?').get(id)?.username ?? null);
  db.prepare(`
    INSERT INTO mod_log(space_id, actor_id, actor_name, target_id, target_name, action, reason, details, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(spaceId, actorId, nameOf(actorId), targetId, nameOf(targetId), action, reason || null,
    details ? JSON.stringify(details) : null, Date.now());
}

// A page of a server's log, newest first: entries older than `before` (an id),
// optionally one action, optionally involving one user (as actor or target).
function getModLog(spaceId, { before = null, action = null, userId = null, hidden = [] } = {}) {
  const where = ['space_id = ?'];
  const args = [spaceId];
  // Lines about a channel the reader can't see are left out (P11-13, L3).
  if (hidden.length) { where.push(`(json_extract(details, '$.channel') IS NULL OR json_extract(details, '$.channel') NOT IN ${inList(hidden)})`); args.push(...hidden); }
  if (before) { where.push('id < ?'); args.push(before); }
  if (action) { where.push('action = ?'); args.push(action); }
  if (userId != null) { where.push('(actor_id = ? OR target_id = ?)'); args.push(userId, userId); }
  const rows = db.prepare(`
    SELECT id, actor_name AS actor, target_name AS target, action, reason, details, created_at AS createdAt
    FROM mod_log WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ?
  `).all(...args, MOD_LOG_PAGE + 1);
  const more = rows.length > MOD_LOG_PAGE;
  const entries = rows.slice(0, MOD_LOG_PAGE).map((r) => ({ ...r, details: r.details ? JSON.parse(r.details) : null }));
  return { entries, more };
}

function createUser(username, email, passwordHash, salt) {
  // The very first account becomes the site admin.
  const first = countUsers() === 0;
  const stmt = db.prepare('INSERT INTO users(username, email, password_hash, salt, site_admin) VALUES (?, ?, ?, ?, ?)');
  return stmt.run(username, email, passwordHash, salt, first ? 1 : 0).lastInsertRowid;
}

// People only: bot accounts (the /imagine bot) don't count.
function countUsers() {
  return db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_bot = 0').get().n;
}

// ---- Site admins ----
function isSiteAdmin(userId) {
  const u = db.prepare('SELECT site_admin FROM users WHERE id = ?').get(userId);
  return !!(u && u.site_admin);
}
function setSiteAdmin(userId, on) {
  db.prepare('UPDATE users SET site_admin = ? WHERE id = ?').run(on ? 1 : 0, userId);
}
function setSiteAdminByUsername(username, on) {
  return db.prepare('UPDATE users SET site_admin = ? WHERE username = ? COLLATE NOCASE').run(on ? 1 : 0, username).changes > 0;
}
function listSiteAdmins() {
  return db.prepare('SELECT username FROM users WHERE site_admin = 1 ORDER BY username COLLATE NOCASE').all().map((r) => r.username);
}

// ---- Suspended accounts (P11-09) ----
// Site admins who can still sign in.
function countActiveSiteAdmins() {
  return db.prepare('SELECT COUNT(*) AS n FROM users WHERE site_admin = 1 AND suspended_at IS NULL').get().n;
}
// Suspend (every session goes and the token version moves on, so every
// sign-in ends) or lift. Returns the new token version.
const setSuspended = db.transaction((userId, on, reason = null) => {
  if (on) {
    db.prepare('UPDATE users SET suspended_at = ?, suspended_reason = ?, token_version = token_version + 1 WHERE id = ?').run(Date.now(), reason || null, userId);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  } else {
    db.prepare('UPDATE users SET suspended_at = NULL, suspended_reason = NULL WHERE id = ?').run(userId);
  }
  const row = db.prepare('SELECT token_version FROM users WHERE id = ?').get(userId);
  return row ? row.token_version : null;
});
// A site admin's view of one account.
function adminUserView(u) {
  const seen = db.prepare('SELECT MAX(last_seen_at) AS t FROM sessions WHERE user_id = ?').get(u.id);
  return {
    username: u.username,
    siteAdmin: !!u.site_admin,
    suspended: !!u.suspended_at,
    suspendedAt: u.suspended_at || null,
    suspendedReason: u.suspended_reason || null,
    lastSeenAt: (seen && seen.t) || null,
  };
}
// People whose name contains `q` (any case), bots left out, at most `limit`.
function searchUsersForAdmin(q, limit = 25) {
  const like = `%${String(q || '').replace(/[!%_]/g, (c) => `!${c}`)}%`;
  return db.prepare("SELECT * FROM users WHERE is_bot = 0 AND username LIKE ? ESCAPE '!' ORDER BY username COLLATE NOCASE LIMIT ?")
    .all(like, limit).map(adminUserView);
}

// ---- Instance settings (key/value) ----
function getSetting(key) {
  const row = db.prepare('SELECT value FROM site_settings WHERE key = ?').get(key);
  return row ? row.value : null;
}
function setSetting(key, value) {
  db.prepare('INSERT INTO site_settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));
}

// ---- Email addresses and their links (P12-02) ----
// A link's token is random and stored only as its SHA-256 hash; it works
// once, before it expires, and only for the purpose it was made for.
const tokenHash = (raw) => require('crypto').createHash('sha256').update(String(raw)).digest('hex');
function createEmailToken(userId, purpose, email, ttlMs) {
  const raw = require('crypto').randomBytes(32).toString('base64url');
  const now = Date.now();
  db.transaction(() => {
    // A new link replaces any earlier one for the same purpose.
    db.prepare('UPDATE email_tokens SET used_at = ? WHERE user_id = ? AND purpose = ? AND used_at IS NULL').run(now, userId, purpose);
    db.prepare('INSERT INTO email_tokens(user_id, purpose, token_hash, email, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(userId, purpose, tokenHash(raw), email || null, now, now + ttlMs);
  })();
  return raw;
}
// Spend a token: { userId, email } if it was valid, else null. One use only.
function useEmailToken(raw, purpose) {
  if (typeof raw !== 'string' || raw.length < 20 || raw.length > 100) return null;
  const now = Date.now();
  const row = db.prepare(`
    UPDATE email_tokens SET used_at = ?
    WHERE token_hash = ? AND purpose = ? AND used_at IS NULL AND expires_at > ?
    RETURNING user_id AS userId, email
  `).get(now, tokenHash(raw), purpose, now);
  return row || null;
}
// The address a confirmation link is waiting on, if any.
function pendingEmail(userId) {
  const row = db.prepare(`
    SELECT email FROM email_tokens
    WHERE user_id = ? AND purpose = 'confirm' AND used_at IS NULL AND expires_at > ?
    ORDER BY id DESC LIMIT 1
  `).get(userId, Date.now());
  return row ? row.email : null;
}
// Whether another account has already confirmed this address.
function emailConfirmedElsewhere(email, userId) {
  return !!db.prepare('SELECT 1 FROM users WHERE email = ? COLLATE NOCASE AND email_verified_at IS NOT NULL AND id != ?').get(email, userId);
}
// Confirm `email` for the account. Someone else's *unconfirmed* claim on the
// same address gives way (a confirmed one wins). 'taken' if it can't.
const confirmEmailTx = db.transaction((userId, email) => {
  if (emailConfirmedElsewhere(email, userId)) return 'taken';
  db.prepare('UPDATE users SET email = NULL WHERE email = ? COLLATE NOCASE AND id != ? AND email_verified_at IS NULL').run(email, userId);
  db.prepare('UPDATE users SET email = ?, email_verified_at = ? WHERE id = ?').run(email, Date.now(), userId);
  return 'ok';
});
const confirmUserEmail = (userId, email) => confirmEmailTx(userId, email);
// Set (unconfirmed) or clear the address directly: sign-up, removing it, or
// adding one while the server can't send email.
function setUserEmail(userId, email) {
  db.prepare('UPDATE users SET email = ?, email_verified_at = NULL WHERE id = ?').run(email || null, userId);
}
const emailConfirmRequired = () => getSetting('require_confirmed_email') === '1';

// ---- Registration invite codes ----
function addRegCode(code, createdBy, expiresAt = null, maxUses = null) {
  db.prepare('INSERT INTO reg_codes(code, created_by, created_at, expires_at, max_uses, uses) VALUES (?, ?, ?, ?, ?, 0)')
    .run(code, createdBy || null, Date.now(), expiresAt, maxUses);
}
function listRegCodes() {
  return db.prepare(`
    SELECT r.id, r.code, r.created_at AS createdAt, r.expires_at AS expiresAt,
           r.max_uses AS maxUses, r.uses, r.revoked_at AS revokedAt, u.username AS createdBy
    FROM reg_codes r LEFT JOIN users u ON r.created_by = u.id
    ORDER BY r.id DESC
  `).all();
}
// A code is usable if it exists, isn't revoked/expired, and is under its use cap.
function findUsableRegCode(code) {
  // Case, spaces and dashes don't matter (see auth/regCodes.js); an exact
  // match wins if two codes only differ in case.
  const norm = normalizeRegCode(code);
  if (!norm) return null;
  const r = db.prepare(`
    SELECT * FROM reg_codes WHERE replace(upper(code), '-', '') = ?
    ORDER BY (code = ?) DESC, id DESC LIMIT 1
  `).get(norm, String(code).trim());
  if (!r || r.revoked_at) return null;
  if (r.expires_at && Date.now() > r.expires_at) return null;
  if (r.max_uses != null && r.uses >= r.max_uses) return null;
  return r;
}
function incrementRegCodeUses(id) {
  db.prepare('UPDATE reg_codes SET uses = uses + 1 WHERE id = ?').run(id);
}
function revokeRegCode(id) {
  return db.prepare('UPDATE reg_codes SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
    .run(Date.now(), id).changes > 0;
}

// Lookups by name take untrusted input straight from request bodies and
// gateway frames; anything that isn't a string simply matches nothing (rather
// than making SQLite throw on an unbindable value).
function getUserByUsername(username) {
  if (typeof username !== 'string') return undefined;
  return db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username); // P11-12
}

function getUserByEmail(email) {
  if (typeof email !== 'string') return undefined;
  return db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(email);
}

function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

// The user's current token version (P6-02), or null when there's no such user.
// ---- Signed-in devices (P9-03) ----
const SESSION_TOUCH_MS = 5 * 60 * 1000; // last-seen updates at most this often
function createSession(userId, device) {
  const id = require('crypto').randomBytes(16).toString('base64url');
  const now = Date.now();
  db.prepare('INSERT INTO sessions(id, user_id, device, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)').run(id, userId, device, now, now);
  return id;
}
function getSession(id) {
  return db.prepare('SELECT id, user_id AS userId, device, created_at AS createdAt, last_seen_at AS lastSeenAt FROM sessions WHERE id = ?').get(id) || null;
}
// Note activity, at most once every few minutes.
function touchSession(session, now = Date.now()) {
  if (now - session.lastSeenAt < SESSION_TOUCH_MS) return;
  db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(now, session.id);
}
// A user's devices, most recently active first; sessions older than a
// token's life (which can't be in use any more) are cleared first.
function listSessions(userId, maxAgeMs) {
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND created_at < ?').run(userId, Date.now() - maxAgeMs);
  return db.prepare('SELECT id, device, created_at AS createdAt, last_seen_at AS lastSeenAt FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC, created_at DESC').all(userId);
}
function deleteSession(userId, id) {
  return db.prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
}
// Sign out every other device: their sessions go, and the token version moves
// on (which also ends tokens from before sessions existed). Returns it. A
// password change has already moved the version on, so it passes bump=false.
const endOtherSessions = db.transaction((userId, keepId, bump = true) => {
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND id IS NOT ?').run(userId, keepId || null);
  if (bump) db.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?').run(userId);
  return getTokenVersion(userId);
});

// null for an unknown or suspended account (P11-09), so its tokens stop working.
function getTokenVersion(userId) {
  const row = db.prepare('SELECT token_version FROM users WHERE id = ? AND suspended_at IS NULL').get(userId);
  return row ? row.token_version : null;
}

// A new password, and a new token version so every older sign-in stops
// working. Returns the new version.
function changePassword(userId, passwordHash, salt) {
  return db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ?, salt = ?, token_version = token_version + 1 WHERE id = ?').run(passwordHash, salt, userId);
    return getTokenVersion(userId);
  })();
}

function setUserPassword(userId, passwordHash, salt) {
  return db.prepare('UPDATE users SET password_hash = ?, salt = ? WHERE id = ?')
    .run(passwordHash, salt, userId).changes > 0;
}

// ---- Presence mode (what the user picked; see gateway/delivery.js) ----
const PRESENCE_MODES = ['online', 'idle', 'dnd', 'invisible'];
function getUserPresence(userId) {
  const row = db.prepare('SELECT presence FROM users WHERE id = ?').get(userId);
  return row && PRESENCE_MODES.includes(row.presence) ? row.presence : 'online';
}
function setUserPresence(userId, mode) {
  if (!PRESENCE_MODES.includes(mode)) return false;
  return db.prepare('UPDATE users SET presence = ? WHERE id = ?').run(mode, userId).changes > 0;
}

// ---- Custom status ----
// { statusText, statusEmoji, statusExpiresAt }, all null when unset. An expired
// status is cleared the moment anyone reads it.
function getUserStatus(userId) {
  const row = db.prepare('SELECT status_text, status_emoji, status_expires_at FROM users WHERE id = ?').get(userId);
  const none = { statusText: null, statusEmoji: null, statusExpiresAt: null };
  if (!row) return none;
  if (row.status_expires_at && row.status_expires_at <= Date.now()) {
    setUserStatus(userId, null, null, null);
    return none;
  }
  return { statusText: row.status_text || null, statusEmoji: row.status_emoji || null, statusExpiresAt: row.status_expires_at || null };
}
function setUserStatus(userId, text, emoji, expiresAt) {
  db.prepare('UPDATE users SET status_text = ?, status_emoji = ?, status_expires_at = ? WHERE id = ?')
    .run(text || null, emoji || null, text || emoji ? expiresAt || null : null, userId);
}
// Clear every status whose time is up; returns those users' ids.
function clearExpiredStatuses(now = Date.now()) {
  const ids = db.prepare('SELECT id FROM users WHERE status_expires_at IS NOT NULL AND status_expires_at <= ?').all(now).map((r) => r.id);
  if (ids.length) {
    db.prepare(`UPDATE users SET status_text = NULL, status_emoji = NULL, status_expires_at = NULL WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);
  }
  return ids;
}

function setUserAvatar(userId, avatarUrl, originalUrl = null, crop = null) {
  return db.prepare('UPDATE users SET avatar_url = ?, avatar_original = ?, avatar_crop = ? WHERE id = ?')
    .run(avatarUrl || null, originalUrl || null, crop ? JSON.stringify(crop) : null, userId).changes > 0;
}

function createFriendRequest(fromId, toId) {
  const stmt = db.prepare('INSERT OR IGNORE INTO friend_requests(from_user, to_user) VALUES (?, ?)');
  stmt.run(fromId, toId);
}

function getIncomingFriendRequests(userId) {
  return db.prepare('SELECT from_user FROM friend_requests WHERE to_user = ?').all(userId);
}

function hasFriendRequest(fromId, toId) {
  return !!db.prepare('SELECT 1 FROM friend_requests WHERE from_user = ? AND to_user = ?').get(fromId, toId);
}

function removeFriendRequest(fromId, toId) {
  db.prepare('DELETE FROM friend_requests WHERE from_user = ? AND to_user = ?').run(fromId, toId);
}

function addFriends(id1, id2) {
  const insert = db.prepare('INSERT OR IGNORE INTO friends(user_id, friend_id) VALUES (?, ?)');
  insert.run(id1, id2);
  insert.run(id2, id1);
}

function removeFriend(id1, id2) {
  const del = db.prepare('DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)');
  del.run(id1, id2, id2, id1);
}

// ---- Blocking (P9-07a) ----
function blockUser(blockerId, blockedId) {
  db.prepare('INSERT OR IGNORE INTO user_blocks(blocker_id, blocked_id, created_at) VALUES (?, ?, ?)').run(blockerId, blockedId, Date.now());
}
function unblockUser(blockerId, blockedId) {
  return db.prepare('DELETE FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?').run(blockerId, blockedId).changes > 0;
}
// The people I've blocked: [{ id, username, avatar, since }], newest first.
function getBlocked(userId) {
  return db.prepare(`
    SELECT u.id, u.username, u.avatar_url AS avatar, b.created_at AS since
    FROM user_blocks b JOIN users u ON u.id = b.blocked_id
    WHERE b.blocker_id = ? ORDER BY b.created_at DESC, u.username
  `).all(userId);
}
function isBlocked(blockerId, blockedId) {
  return !!db.prepare('SELECT 1 FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?').get(blockerId, blockedId);
}
// Either has blocked the other (private contact stops both ways).
function eitherBlocked(a, b) {
  return !!db.prepare('SELECT 1 FROM user_blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)').get(a, b, b, a);
}

function getFriends(userId) {
  const rows = db.prepare('SELECT friend_id FROM friends WHERE user_id = ?').all(userId);
  return rows.map(r => getUserById(r.friend_id)).filter(Boolean);
}

// ---- Multi-step writes (each runs in one transaction) ----

// Create a server, make its creator the owner, and add its starting channels.
// Any failure part-way (e.g. a duplicate channel name) rolls the whole thing
// back. Returns the new space id, or null if the name is already taken.
// Starter channel sets for a new server. Names are already normalized (as a
// user-made channel would be). Unknown keys fall back to 'blank'.
const SERVER_TEMPLATES = {
  blank: { channels: [{ name: 'general', type: 'text' }] },
  friends: {
    channels: [
      { name: 'general', type: 'text' }, { name: 'memes', type: 'text' }, { name: 'media', type: 'text' },
      { name: 'lounge', type: 'voice' },
    ],
  },
  gaming: {
    channels: [
      { name: 'general', type: 'text' }, { name: 'lfg', type: 'text' }, { name: 'clips', type: 'text' },
      { name: 'squad-1', type: 'voice' }, { name: 'squad-2', type: 'voice' },
    ],
  },
  study: {
    channels: [
      { name: 'general', type: 'text' }, { name: 'resources', type: 'text' }, { name: 'questions', type: 'text' },
      { name: 'study-room', type: 'voice' },
    ],
  },
};
function templateChannels(key) {
  const t = Object.prototype.hasOwnProperty.call(SERVER_TEMPLATES, key) ? SERVER_TEMPLATES[key] : SERVER_TEMPLATES.blank;
  return t.channels;
}

const createSpaceWithDefaults = db.transaction((name, ownerId, channels = [{ name: 'general', type: 'text' }]) => {
  const spaceId = createSpaceOwned(name, ownerId);
  if (!spaceId) return null;
  // P3-25a: every new server starts with the two default categories.
  const cats = { text: createCategory(spaceId, DEFAULT_CATEGORY.text).id, voice: createCategory(spaceId, DEFAULT_CATEGORY.voice).id };
  const insert = db.prepare('INSERT INTO channels(space_id, name, type, category_id, position) VALUES (?, ?, ?, ?, ?)');
  const count = { text: 0, voice: 0 };
  for (const ch of channels) {
    const kind = ch.type === 'voice' ? 'voice' : 'text';
    insert.run(spaceId, ch.name, kind, cats[kind], count[kind]++);
  }
  syncSpaceRoles(spaceId);
  return spaceId;
});

// Store a channel message, mark it read for its author, and record which of
// the @mentioned usernames are members. Returns { id, timestamp, mentions }, or
// null if the channel doesn't exist.
const storeMessageWithMentions = db.transaction(
  (spaceName, channelName, content, authorId, attachments, spoiler, spaceId, mentionNames = [], replyTo = null) => {
    const stored = storeMessage(spaceName, channelName, content, authorId, attachments, spoiler, replyTo);
    if (!stored) return null;
    markRead(authorId, spaceName, channelName, stored.id);
    const mentionedIds = [];
    const mentions = mentionNames.length ? addMentions(stored.id, spaceId, mentionNames, mentionedIds, authorId) : [];
    // In a thread, posting or being mentioned makes you a follower.
    // `newFollows` lists who just became one, so they can be told.
    const newFollows = [];
    const threadId = threadChannelId(spaceName, channelName);
    if (threadId) {
      for (const uid of [authorId, ...mentionedIds]) if (uid && followThread(uid, threadId)) newFollows.push(uid);
    }
    return { ...stored, mentions, mentionedIds, newFollows };
  }
);

// Join a server through an invite. The use count only goes up if the invite
// still has room, so concurrent joiners can't overrun max_uses.
// Returns 'joined' | 'already' | 'expired' | 'exhausted' | 'invalid'.
const redeemInvite = db.transaction((code, userId) => {
  const invite = getInvite(code);
  if (!invite) return 'invalid';
  if (isBanned(invite.space_id, userId)) return 'banned';
  if (invite.expires_at && Date.now() > invite.expires_at) return 'expired';
  if (invite.max_uses && invite.uses >= invite.max_uses) return 'exhausted';
  if (isMember(invite.space_id, userId)) return 'already';
  const claimed = db.prepare(
    'UPDATE invites SET uses = uses + 1 WHERE code = ? AND (max_uses IS NULL OR uses < max_uses)'
  ).run(invite.code).changes;
  if (!claimed) return 'exhausted';
  addMember(invite.space_id, userId, 'member');
  const space = getSpaceById(invite.space_id);
  if (space) markSpaceRead(userId, space.name); // start with a clean slate, not a wall of unread
  return 'joined';
});

class RegistrationRefused extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

// Create an account, re-checking the account cap and claiming one use of the
// registration code (if any) in the same transaction, so concurrent sign-ups
// can't overrun either limit. The password must already be hashed.
// Returns { userId } or { error: 'limit' | 'code' | 'exists' }.
const insertUserTx = db.transaction(({ username, email, passwordHash, salt, regCodeId, maxAccounts, inviteCode = null }) => {
  if (maxAccounts > 0 && countUsers() >= maxAccounts) throw new RegistrationRefused('limit');
  if (regCodeId != null) {
    const claimed = db.prepare(`
      UPDATE reg_codes SET uses = uses + 1
      WHERE id = ? AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > ?)
        AND (max_uses IS NULL OR uses < max_uses)
    `).run(regCodeId, Date.now()).changes;
    if (!claimed) throw new RegistrationRefused('code');
  }
  const userId = createUser(username, email, passwordHash, salt);
  // P14-01: signing up from an invite joins its server in the same step;
  // if it can't be redeemed (used up meanwhile), no account is made either.
  if (inviteCode) {
    const result = redeemInvite(inviteCode, userId);
    if (result !== 'joined') throw new RegistrationRefused(`invite-${result}`);
  }
  return userId;
});
function createUserRedeemingCode(fields) {
  try {
    return { userId: insertUserTx(fields) };
  } catch (e) {
    if (e instanceof RegistrationRefused) return { error: e.reason };
    if (e && e.code === 'SQLITE_CONSTRAINT_UNIQUE') return { error: 'exists' };
    throw e;
  }
}

// ---- /imagine (P2-20a) ----
// The bot that posts generated images: a real users row (so messages have an
// author) that can never sign in (is_bot, and an impossible password hash).
const IMAGINE_BOT_NAMES = ['Imagine', 'Imagine-bot', 'Imagine-bot-2'];
let imagineBotId = null;
function ensureImagineBot() {
  if (imagineBotId) return imagineBotId;
  const existing = db.prepare('SELECT id FROM users WHERE is_bot = 1 ORDER BY id LIMIT 1').get();
  if (existing) return (imagineBotId = existing.id);
  for (const name of IMAGINE_BOT_NAMES) {
    if (db.prepare('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE').get(name)) continue;
    const info = db.prepare("INSERT INTO users(username, email, password_hash, salt, site_admin, is_bot) VALUES (?, ?, '!', '!', 0, 1)")
      .run(name, `${name.toLowerCase()}@bot.invalid`);
    return (imagineBotId = Number(info.lastInsertRowid));
  }
  throw new Error('No free username for the imagine bot');
}
function isBotUser(userId) {
  return !!db.prepare('SELECT 1 FROM users WHERE id = ? AND is_bot = 1').get(userId);
}
// The bot posts in a channel; returns { id, timestamp } (or null).
function postAsBot(spaceName, channelName, content) {
  return storeMessage(spaceName, channelName, content, ensureImagineBot());
}
// The bot rewrites one of its own messages (content and attachments).
function updateBotMessage(messageId, content, attachments = []) {
  const list = Array.isArray(attachments) ? attachments : [];
  return db.prepare('UPDATE messages SET content = ?, attachment_url = ?, attachments = ? WHERE id = ? AND author_id = ?')
    .run(content, list[0] || null, list.length ? JSON.stringify(list) : null, messageId, ensureImagineBot()).changes > 0;
}

// A server's /imagine settings.
function getSpaceImagine(spaceId) {
  const r = db.prepare('SELECT imagine_enabled, imagine_daily_limit FROM spaces WHERE id = ?').get(spaceId);
  return r ? { enabled: !!r.imagine_enabled, dailyLimit: r.imagine_daily_limit ?? null } : null;
}
function setSpaceImagine(spaceId, { enabled, dailyLimit } = {}) {
  const cur = getSpaceImagine(spaceId);
  if (!cur) return null;
  db.prepare('UPDATE spaces SET imagine_enabled = ?, imagine_daily_limit = ? WHERE id = ?').run(
    (enabled === undefined ? cur.enabled : !!enabled) ? 1 : 0,
    dailyLimit === undefined ? cur.dailyLimit : dailyLimit,
    spaceId
  );
  return getSpaceImagine(spaceId);
}
// Servers that set their own /imagine daily limit (P3-21): [{ space, limit }].
function getSpaceImagineLimits() {
  return db.prepare('SELECT name AS space, imagine_daily_limit AS "limit" FROM spaces WHERE imagine_daily_limit IS NOT NULL ORDER BY name COLLATE NOCASE').all();
}
// The 18+ flag of a channel; a thread answers with its parent's.
function isChannelNsfw(spaceName, channelName) {
  const r = db.prepare(`
    SELECT COALESCE(p.nsfw, c.nsfw) AS nsfw FROM channels c JOIN spaces s ON c.space_id = s.id
    LEFT JOIN channels p ON p.id = c.parent_id WHERE s.name = ? AND c.name = ?
  `).get(spaceName, channelName);
  return !!(r && r.nsfw);
}
// A channel's topic (P3-20a): plain text, or null to clear. Not for threads.
function setChannelTopic(spaceName, channelName, topic) {
  return db.prepare(`
    UPDATE channels SET topic = ? WHERE space_id = (SELECT id FROM spaces WHERE name = ?) AND name = ? AND type IS NOT 'thread'
  `).run(topic || null, spaceName, channelName).changes > 0;
}
// ---- Slow mode (P3-26d) ----
function setChannelSlowmode(spaceName, channelName, seconds) {
  return db.prepare(`
    UPDATE channels SET slowmode_seconds = ? WHERE space_id = (SELECT id FROM spaces WHERE name = ?) AND name = ? AND type IS NOT 'thread'
  `).run(seconds, spaceName, channelName).changes > 0;
}
// A channel's slow mode in seconds; a thread answers with its parent's.
function slowmodeFor(spaceName, channelName) {
  const row = db.prepare(`
    SELECT COALESCE(p.slowmode_seconds, c.slowmode_seconds) AS s
    FROM channels c JOIN spaces sp ON sp.id = c.space_id LEFT JOIN channels p ON p.id = c.parent_id
    WHERE sp.name = ? AND c.name = ?
  `).get(spaceName, channelName);
  return row ? row.s || 0 : 0;
}
// When someone last posted in a channel (ms), or 0.
function lastPostAt(spaceName, channelName, userId) {
  const row = db.prepare(`
    SELECT MAX(m.created_at) AS at FROM messages m JOIN channels c ON c.id = m.channel_id JOIN spaces sp ON sp.id = c.space_id
    WHERE sp.name = ? AND c.name = ? AND m.author_id = ?
  `).get(spaceName, channelName, userId);
  return row && row.at ? row.at : 0;
}

function setChannelNsfw(spaceName, channelName, on) {
  return db.prepare(`
    UPDATE channels SET nsfw = ? WHERE space_id = (SELECT id FROM spaces WHERE name = ?) AND name = ? AND type IS NOT 'thread'
  `).run(on ? 1 : 0, spaceName, channelName).changes > 0;
}

// Generation jobs.
const JOB_COLUMNS = { status: 'status', error: 'error', cost: 'cost', model: 'model', startedAt: 'started_at', finishedAt: 'finished_at', messageId: 'message_id' };
function createImagineJob(j) {
  const info = db.prepare(`
    INSERT INTO imagine_jobs(user_id, space_id, channel_id, engine, model, prompt, shape, quality, permissive, cost, status, created_at, kind, source_url, strength, preset)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?)
  `).run(j.userId, j.spaceId, j.channelId, j.engine, j.model || null, j.prompt, j.shape, j.quality, j.permissive ? 1 : 0, j.cost || 0, Date.now(), j.kind || 'generate', j.sourceUrl || null, j.strength ?? null, j.preset || null);
  return Number(info.lastInsertRowid);
}
function updateImagineJob(id, fields) {
  const sets = [];
  const vals = [];
  for (const [k, col] of Object.entries(JOB_COLUMNS)) {
    if (fields[k] !== undefined) {
      sets.push(`${col} = ?`);
      vals.push(fields[k]);
    }
  }
  if (sets.length) db.prepare(`UPDATE imagine_jobs SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
}
function getImagineJob(id) {
  return db.prepare('SELECT * FROM imagine_jobs WHERE id = ?').get(id);
}
// A message's attachment URLs (P3-29: the image an upscale starts from).
function getMessageAttachments(messageId) {
  const row = db.prepare('SELECT attachment_url AS attachment, attachments FROM messages WHERE id = ?').get(messageId);
  return row ? hydrateAttachments(row).attachments : [];
}
// The job behind one of the bot's messages (P3-23: Retry and Variations).
function getImagineJobByMessage(messageId) {
  return db.prepare('SELECT * FROM imagine_jobs WHERE message_id = ? ORDER BY id DESC LIMIT 1').get(messageId);
}
// How many images a user asked for in chat since `since` (failures and
// admins' test images don't count).
function countImagineJobsSince(userId, since) {
  return db.prepare("SELECT COUNT(*) AS n FROM imagine_jobs WHERE user_id = ? AND created_at >= ? AND status != 'failed' AND space_id IS NOT NULL").get(userId, since).n;
}
// The last real cost of one image from an engine's model at a quality (P2-20c).
function lastImagineCost(engine, model, quality) {
  const r = db.prepare("SELECT cost FROM imagine_jobs WHERE engine = ? AND model = ? AND quality = ? AND status = 'done' AND cost > 0 ORDER BY id DESC LIMIT 1").get(engine, model, quality);
  return r ? r.cost : null;
}
// Credits an engine has used (or has queued) since `since`.
function imagineCreditsSince(engine, since) {
  return db.prepare("SELECT COALESCE(SUM(cost), 0) AS c FROM imagine_jobs WHERE engine = ? AND created_at >= ? AND status != 'failed'").get(engine, since).c;
}
// Jobs a restart interrupted.
function getUnfinishedImagineJobs() {
  return db.prepare("SELECT * FROM imagine_jobs WHERE status IN ('queued', 'running') ORDER BY id").all();
}

// Servers that existed before the roles migration get their seeded roles now.
if (versionBefore > 0 && versionBefore < 12) seedAllSpaceRoles();

module.exports = {
  getSpaceCard,
  createEmailToken,
  useEmailToken,
  pendingEmail,
  emailConfirmedElsewhere,
  confirmUserEmail,
  setUserEmail,
  emailConfirmRequired,
  createSpace,
  createChannel,
  getCategories,
  spaceChannelNames,
  createCategory,
  renameCategory,
  deleteCategory,
  setLayout,
  getCategoryOverrides,
  setCategoryOverride,
  copyCategoryOverrides,
  applyCategoryOverrides,
  deleteSpace,
  deleteChannel,
  renameChannel,
  renameSpace,
  getSpaceByName,
  getSpaceById,
  channelType,
  createSpaceOwned,
  addMember,
  removeMember,
  leaveSpace,
  getMemberRole,
  setMemberRole,
  isMember,
  getUserSpaces,
  setSpaceIcon,
  roleRank,
  getSpacePermissions,
  setSpacePermissions,
  canDo,
  getChannelPerms,
  setChannelPerms,
  getRoles,
  getRole,
  createRole,
  updateRole,
  deleteRole,
  getMemberRoleIds,
  addMemberRole,
  removeMemberRole,
  getChannelOverrides,
  setChannelOverride,
  syncSpaceRoles,
  createRoleAtBottom,
  reorderRoles,
  getRoleHolders,
  getMemberRolesMap,
  seedAllSpaceRoles,
  resolveAccess,
  visibleChannelIds,
  channelRef,
  OWNER_POSITION,
  DEFAULT_PERMISSIONS,
  getSpaceEmoji,
  addSpaceEmoji,
  deleteSpaceEmoji,
  spaceHasEmoji,
  MAX_EMOJI_PER_SPACE,
  getSpaceMembers,
  createInvite,
  getInvite,
  incrementInviteUses,
  storeMessage,
  editMessage,
  deleteMessage,
  getMessages,
  getMessagesAfter,
  getMessagesAround,
  getDmMessagesAround,
  getDmReplyTarget,
  createSpaceWithDefaults,
  SERVER_TEMPLATES,
  templateChannels,
  storeMessageWithMentions,
  redeemInvite,
  createUserRedeemingCode,
  getMessagesBefore,
  toggleReaction,
  getReaction,
  isMessageInChannel,
  getMessageLocation,
  isThreadChannel,
  createThread,
  getThread,
  getThreads,
  threadChannelId,
  setThreadArchived,
  archiveQuietThreads,
  followThread,
  unfollowThread,
  isFollowingThread,
  getThreadFollows,
  getPushSubscriptions,
  savePushSubscription,
  deletePushSubscription,
  deletePushEndpoint,
  getReplyTarget,
  deleteMessageById,
  getMessageVersions,
  getDmVersions,
  logModAction,
  getModLog,
  transferOwnership,
  createReport,
  listReports,
  getReport,
  countOpenReports,
  hiddenChannelNames,
  closeReports,
  setMemberTimeout,
  setChannelSlowmode,
  slowmodeFor,
  lastPostAt,
  getMemberTimeout,
  getTimeoutsMap,
  banMember,
  unbanMember,
  isBanned,
  getBans,
  memberMessagesSince,
  getCoMemberIds,
  markRead,
  getUnreadCounts,
  markSpaceRead,
  addMentions,
  getMentionCounts,
  storeDm,
  // P9-06a: conversations
  findPair,
  getOrCreatePair,
  getConversation,
  participantsOf,
  participantIds,
  isParticipant,
  pairPartner,
  storeConversationDm,
  getConversationMessages,
  getConversationReplyTarget,
  getConversationMessagesAround,
  getConversationMessagesBefore,
  getConversationMessagesAfter,
  markConversationRead,
  // P9-06c: groups
  canAddToGroup,
  canStartDm,
  getDmPolicy,
  setDmPolicy,
  DM_POLICIES,
  createGroup,
  addParticipants,
  leaveConversation,
  renameConversation,
  setConversationMuted,
  getConversationSummary,
  getDmMessages,
  getDmMessagesAfter,
  getDmMessagesBefore,
  getDmById,
  editDm,
  deleteDm,
  getDmConversations,
  markDmRead,
  getDmUnreadCounts,
  searchMessages,
  createUser,
  countUsers,
  ensureImagineBot,
  isBotUser,
  postAsBot,
  updateBotMessage,
  getSpaceImagine,
  getSpaceImagineLimits,
  setSpaceImagine,
  isChannelNsfw,
  setChannelNsfw,
  setChannelTopic,
  createImagineJob,
  updateImagineJob,
  getImagineJob,
  getImagineJobByMessage,
  getMessageAttachments,
  countImagineJobsSince,
  lastImagineCost,
  imagineCreditsSince,
  getUnfinishedImagineJobs,
  isSiteAdmin,
  setSiteAdmin,
  setSiteAdminByUsername,
  listSiteAdmins,
  countActiveSiteAdmins,
  setSuspended,
  adminUserView,
  searchUsersForAdmin,
  getSetting,
  pinMessage,
  unpinMessage,
  getPins,
  MAX_PINS_PER_CHANNEL,
  PRESENCE_MODES,
  getUserPresence,
  setUserPresence,
  getUserStatus,
  setUserStatus,
  clearExpiredStatuses,
  getLinkPreview,
  saveLinkPreview,
  messageExists,
  setEmbeds,
  hideEmbeds,
  embedsHidden,
  getEmbedUrls,
  attachEmbeds,
  setSetting,
  addRegCode,
  listRegCodes,
  findUsableRegCode,
  incrementRegCodeUses,
  revokeRegCode,
  getUserByUsername,
  getUserByEmail,
  getUserById,
  setUserPassword,
  getTokenVersion,
  changePassword,
  createSession,
  getSession,
  touchSession,
  listSessions,
  deleteSession,
  endOtherSessions,
  setUserAvatar,
  createFriendRequest,
  getIncomingFriendRequests,
  hasFriendRequest,
  removeFriendRequest,
  addFriends,
  removeFriend,
  getFriends,
  blockUser,
  unblockUser,
  getBlocked,
  isBlocked,
  eitherBlocked,
  cleanupOrphans,
  raw: db, // the underlying connection, for tests and maintenance scripts
};
