const path = require('path');
const Database = require('better-sqlite3');
const { runMigrations } = require('./migrations');
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
  const first = db.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get();
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
  `DELETE FROM dm_messages WHERE ${NOT_A_USER('user_a')} OR ${NOT_A_USER('user_b')}`,
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
  edit_server: 2,
  delete_others_messages: 2,
  pin_messages: 2,
  manage_emoji: 2,
  manage_roles: 3,
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
  return { owner, actions, position, roleIds, channel };
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

function createChannel(spaceName, channelName, type = 'text') {
  createSpace(spaceName);
  const space = db.prepare('SELECT id FROM spaces WHERE name = ?').get(spaceName);
  const made = db.prepare('INSERT OR IGNORE INTO channels(space_id, name, type) VALUES (?, ?, ?)')
    .run(space.id, channelName, type === 'voice' ? 'voice' : 'text').changes > 0;
  if (made && !hasRoles(space.id)) syncSpaceRoles(space.id); // seed a bare server's roles
}

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
  const channelStmt = db.prepare(
    "SELECT id, name, type, view_role AS view, post_role AS post FROM channels WHERE space_id = ? AND type IS NOT 'thread' ORDER BY id"
  );
  const emojiStmt = db.prepare('SELECT id, name, url FROM space_emoji WHERE space_id = ? ORDER BY name');
  return spaces.map((s) => {
    // Members only see channels their roles allow them to view; `canPost`
    // and `abilities` tell the client what it may offer (the server checks too).
    const access = resolveAccess(s.id, userId);
    const chans = channelStmt.all(s.id)
      .map((c) => ({ ...c, can: access ? access.channel(c.id) : { view: false, post: false } }))
      .filter((c) => c.can.view);
    const channelMeta = {};
    for (const c of chans) channelMeta[c.name] = { type: c.type, view: c.view || 1, post: c.post || 1, canPost: c.can.post };
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

function getInvite(code) {
  return db.prepare('SELECT * FROM invites WHERE code = ?').get(code);
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
              ELSE (SELECT COUNT(*) FROM messages tm WHERE tm.channel_id = th.id) END AS threadCount
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
const hydrateMessage = (row) => hydrateThread(hydratePinned(hydrateReply(hydrateAttachments(row))));

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
    SELECT s.name AS space, c.name AS channel, m.author_id AS authorId
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
// `ids` (optional) collects the mentioned users' ids.
function addMentions(messageId, spaceId, usernames, ids = []) {
  if (!usernames.length) return [];
  const memberByName = db.prepare(
    'SELECT u.id, u.username FROM users u JOIN space_members sm ON sm.user_id = u.id WHERE sm.space_id = ? AND u.username = ?'
  );
  const insert = db.prepare('INSERT OR IGNORE INTO mentions(message_id, user_id) VALUES (?, ?)');
  const resolved = [];
  for (const name of usernames) {
    const row = memberByName.get(spaceId, name);
    if (row) {
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
function dmPair(a, b) {
  return a < b ? [a, b] : [b, a];
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
         pu.username AS replyAuthor
  FROM dm_messages m
  JOIN users u ON m.author_id = u.id
  LEFT JOIN dm_messages p ON p.id = m.reply_to
  LEFT JOIN users pu ON pu.id = p.author_id
`;

function storeDm(fromId, toId, content, attachments = [], spoiler = false, replyTo = null) {
  const [a, b] = dmPair(fromId, toId);
  const list = Array.isArray(attachments) ? attachments : (attachments ? [attachments] : []);
  const first = list[0] || null;
  const json = list.length ? JSON.stringify(list) : null;
  const createdAt = Date.now();
  const info = db.prepare(
    'INSERT INTO dm_messages(user_a, user_b, author_id, content, attachment_url, attachments, attachment_spoiler, created_at, reply_to) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(a, b, fromId, content, first, json, spoiler ? 1 : 0, createdAt, replyTo || null);
  return { id: info.lastInsertRowid, timestamp: createdAt };
}

function getDmMessages(userId, otherId, limit = 50, offset = 0) {
  const [a, b] = dmPair(userId, otherId);
  return attachEmbeds('dm', db.prepare(`${DM_SELECT} WHERE m.user_a = ? AND m.user_b = ? ORDER BY m.id DESC LIMIT ? OFFSET ?`)
    .all(a, b, limit, offset).reverse().map(hydrateMessage));
}

// The quote for a new DM reply, if `messageId` is in this same conversation
// (so a reply can never reveal someone else's messages).
function getDmReplyTarget(userId, otherId, messageId) {
  const [a, b] = dmPair(userId, otherId);
  const row = db.prepare(`${DM_SELECT} WHERE m.user_a = ? AND m.user_b = ? AND m.id = ?`).get(a, b, messageId);
  if (!row) return null;
  return {
    id: row.id,
    authorId: row.authorId,
    author: row.author || 'Unknown',
    snippet: replySnippet(row.content, !!(row.attachment || row.attachments)),
  };
}

// A window of a conversation around one message (see getMessagesAround).
function getDmMessagesAround(userId, otherId, messageId, half = 25) {
  const [a, b] = dmPair(userId, otherId);
  const where = 'WHERE m.user_a = ? AND m.user_b = ?';
  if (!db.prepare(`${DM_SELECT} ${where} AND m.id = ?`).get(a, b, messageId)) return null;
  const before = db.prepare(`${DM_SELECT} ${where} AND m.id < ? ORDER BY m.id DESC LIMIT ?`).all(a, b, messageId, half).reverse();
  const from = db.prepare(`${DM_SELECT} ${where} AND m.id >= ? ORDER BY m.id ASC LIMIT ?`).all(a, b, messageId, half + 1);
  return attachEmbeds('dm', [...before, ...from].map(hydrateMessage));
}

// The page of DMs just older than `beforeId`, oldest-first.
function getDmMessagesBefore(userId, otherId, beforeId, limit = 50) {
  const [a, b] = dmPair(userId, otherId);
  return attachEmbeds('dm', db.prepare(`${DM_SELECT} WHERE m.user_a = ? AND m.user_b = ? AND m.id < ? ORDER BY m.id DESC LIMIT ?`)
    .all(a, b, beforeId, limit).reverse().map(hydrateMessage));
}

function getDmMessagesAfter(userId, otherId, afterId, limit = 200) {
  const [a, b] = dmPair(userId, otherId);
  return attachEmbeds('dm', db.prepare(`${DM_SELECT} WHERE m.user_a = ? AND m.user_b = ? AND m.id > ? ORDER BY m.id ASC LIMIT ?`)
    .all(a, b, afterId, limit).map(hydrateMessage));
}

// The two participants + author of a DM, so we can notify both sides.
function getDmById(messageId) {
  return db.prepare('SELECT id, user_a, user_b, author_id FROM dm_messages WHERE id = ?').get(messageId) || null;
}

// Edit/delete a DM, but only if the requester is its author.
function editDm(messageId, authorId, content) {
  const editedAt = Date.now();
  const changed = db.prepare(
    'UPDATE dm_messages SET content = ?, edited_at = ? WHERE id = ? AND author_id = ?'
  ).run(content, editedAt, messageId, authorId).changes;
  return changed > 0 ? editedAt : null;
}

function deleteDm(messageId, authorId) {
  return db.prepare('DELETE FROM dm_messages WHERE id = ? AND author_id = ?')
    .run(messageId, authorId).changes > 0;
}

// One row per conversation partner, newest first, with the last message.
function getDmConversations(userId) {
  return db.prepare(`
    SELECT partner.username AS username, partner.avatar_url AS avatar,
           last.content AS lastContent, last.attachment_url AS lastAttachment, last.created_at AS lastTimestamp
    FROM (
      SELECT CASE WHEN user_a = ? THEN user_b ELSE user_a END AS other_id, MAX(id) AS last_id
      FROM dm_messages
      WHERE user_a = ? OR user_b = ?
      GROUP BY other_id
    ) conv
    JOIN users partner ON partner.id = conv.other_id
    JOIN dm_messages last ON last.id = conv.last_id
    ORDER BY last.id DESC
  `).all(userId, userId, userId);
}

function markDmRead(userId, otherId, lastReadId) {
  db.prepare(`
    INSERT INTO dm_read_state(user_id, other_id, last_read_id)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, other_id)
    DO UPDATE SET last_read_id = MAX(last_read_id, excluded.last_read_id)
  `).run(userId, otherId, lastReadId || 0);
}

// Unread DM counts per partner (only the partner's own messages count).
function getDmUnreadCounts(userId) {
  return db.prepare(`
    SELECT partner.username AS other, COUNT(m.id) AS count
    FROM dm_messages m
    JOIN users partner ON partner.id = (CASE WHEN m.user_a = ? THEN m.user_b ELSE m.user_a END)
    LEFT JOIN dm_read_state rs ON rs.user_id = ? AND rs.other_id = partner.id
    WHERE (m.user_a = ? OR m.user_b = ?) AND m.author_id != ? AND m.id > COALESCE(rs.last_read_id, 0)
    GROUP BY partner.id
    HAVING count > 0
  `).all(userId, userId, userId, userId, userId);
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

  const dms = db.prepare(`
    SELECT m.id, m.content, COALESCE(m.created_at, 0) AS timestamp,
           u.username AS author, u.avatar_url AS authorAvatar,
           partner.username AS dmWith
    FROM dm_messages m
    JOIN users u ON m.author_id = u.id
    JOIN users partner ON partner.id = (CASE WHEN m.user_a = ? THEN m.user_b ELSE m.user_a END)
    WHERE (m.user_a = ? OR m.user_b = ?) AND m.content LIKE ? ESCAPE '\\'
    ORDER BY m.id DESC
    LIMIT ?
  `).all(userId, userId, userId, like, limit);

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
function editMessage(messageId, authorId, content) {
  const editedAt = Date.now();
  const changed = db.prepare(
    'UPDATE messages SET content = ?, edited_at = ? WHERE id = ? AND author_id = ?'
  ).run(content, editedAt, messageId, authorId).changes;
  return changed > 0 ? editedAt : null;
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

function createUser(username, email, passwordHash, salt) {
  // The very first account becomes the site admin.
  const first = countUsers() === 0;
  const stmt = db.prepare('INSERT INTO users(username, email, password_hash, salt, site_admin) VALUES (?, ?, ?, ?, ?)');
  return stmt.run(username, email, passwordHash, salt, first ? 1 : 0).lastInsertRowid;
}

function countUsers() {
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
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
  return db.prepare('UPDATE users SET site_admin = ? WHERE username = ?').run(on ? 1 : 0, username).changes > 0;
}
function listSiteAdmins() {
  return db.prepare('SELECT username FROM users WHERE site_admin = 1 ORDER BY username COLLATE NOCASE').all().map((r) => r.username);
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
  if (!code) return null;
  const r = db.prepare('SELECT * FROM reg_codes WHERE code = ?').get(code);
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
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}

function getUserByEmail(email) {
  if (typeof email !== 'string') return undefined;
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email);
}

function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
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
  const insert = db.prepare('INSERT INTO channels(space_id, name, type) VALUES (?, ?, ?)');
  for (const ch of channels) insert.run(spaceId, ch.name, ch.type === 'voice' ? 'voice' : 'text');
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
    const mentions = mentionNames.length ? addMentions(stored.id, spaceId, mentionNames, mentionedIds) : [];
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
  if (invite.expires_at && Date.now() > invite.expires_at) return 'expired';
  if (invite.max_uses && invite.uses >= invite.max_uses) return 'exhausted';
  if (isMember(invite.space_id, userId)) return 'already';
  const claimed = db.prepare(
    'UPDATE invites SET uses = uses + 1 WHERE code = ? AND (max_uses IS NULL OR uses < max_uses)'
  ).run(code).changes;
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
const insertUserTx = db.transaction(({ username, email, passwordHash, salt, regCodeId, maxAccounts }) => {
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
  return createUser(username, email, passwordHash, salt);
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

// Servers that existed before the roles migration get their seeded roles now.
if (versionBefore > 0 && versionBefore < 12) seedAllSpaceRoles();

module.exports = {
  createSpace,
  createChannel,
  deleteSpace,
  deleteChannel,
  renameSpace,
  getSpaceByName,
  getSpaceById,
  channelType,
  createSpaceOwned,
  addMember,
  removeMember,
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
  getCoMemberIds,
  markRead,
  getUnreadCounts,
  markSpaceRead,
  addMentions,
  getMentionCounts,
  storeDm,
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
  isSiteAdmin,
  setSiteAdmin,
  setSiteAdminByUsername,
  listSiteAdmins,
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
  setUserAvatar,
  createFriendRequest,
  getIncomingFriendRequests,
  hasFriendRequest,
  removeFriendRequest,
  addFriends,
  removeFriend,
  getFriends,
  cleanupOrphans,
  raw: db, // the underlying connection, for tests and maintenance scripts
};
