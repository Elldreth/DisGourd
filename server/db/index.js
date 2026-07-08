const path = require('path');
const Database = require('better-sqlite3');
require('dotenv').config({ quiet: true });

const dbPath = process.env.DB_PATH || path.join(__dirname, 'disgourd.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS spaces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL
  );
  CREATE TABLE IF NOT EXISTS channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    space_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'text',
    UNIQUE(space_id, name),
    FOREIGN KEY(space_id) REFERENCES spaces(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id INTEGER NOT NULL,
    author_id INTEGER,
    content TEXT NOT NULL,
    attachment_url TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at INTEGER,
    FOREIGN KEY(channel_id) REFERENCES channels(id) ON DELETE CASCADE,
    FOREIGN KEY(author_id) REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS friend_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_user INTEGER NOT NULL,
    to_user INTEGER NOT NULL,
    UNIQUE(from_user, to_user),
    FOREIGN KEY(from_user) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(to_user) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS friends (
    user_id INTEGER NOT NULL,
    friend_id INTEGER NOT NULL,
    UNIQUE(user_id, friend_id),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(friend_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS space_members (
    space_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    joined_at INTEGER,
    UNIQUE(space_id, user_id),
    FOREIGN KEY(space_id) REFERENCES spaces(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS invites (
    code TEXT PRIMARY KEY,
    space_id INTEGER NOT NULL,
    created_by INTEGER,
    created_at INTEGER,
    expires_at INTEGER,
    max_uses INTEGER,
    uses INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY(space_id) REFERENCES spaces(id) ON DELETE CASCADE,
    FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE TABLE IF NOT EXISTS reactions (
    message_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    emoji TEXT NOT NULL,
    UNIQUE(message_id, user_id, emoji),
    FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS read_state (
    user_id INTEGER NOT NULL,
    space TEXT NOT NULL,
    channel TEXT NOT NULL,
    last_read_id INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(user_id, space, channel)
  );
  CREATE TABLE IF NOT EXISTS dm_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_a INTEGER NOT NULL,
    user_b INTEGER NOT NULL,
    author_id INTEGER NOT NULL,
    content TEXT,
    attachment_url TEXT,
    created_at INTEGER,
    edited_at INTEGER,
    FOREIGN KEY(user_a) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(user_b) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS dm_read_state (
    user_id INTEGER NOT NULL,
    other_id INTEGER NOT NULL,
    last_read_id INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(user_id, other_id)
  );
  CREATE TABLE IF NOT EXISTS mentions (
    message_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    PRIMARY KEY(message_id, user_id),
    FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

// Migrate existing databases to include new columns if missing
try {
  const hasAuthor = db.prepare("PRAGMA table_info(messages)").all().some(c => c.name === 'author_id');
  if (!hasAuthor) {
    db.exec('ALTER TABLE messages ADD COLUMN author_id INTEGER');
  }
  const hasAttachment = db.prepare("PRAGMA table_info(messages)").all().some(c => c.name === 'attachment_url');
  if (!hasAttachment) {
    db.exec('ALTER TABLE messages ADD COLUMN attachment_url TEXT');
  }
  const hasEmail = db.prepare("PRAGMA table_info(users)").all().some(c => c.name === 'email');
  if (!hasEmail) {
    db.exec('ALTER TABLE users ADD COLUMN email TEXT');
  }
  const hasCreatedAt = db.prepare("PRAGMA table_info(messages)").all().some(c => c.name === 'created_at');
  if (!hasCreatedAt) {
    db.exec('ALTER TABLE messages ADD COLUMN created_at INTEGER');
    // Backfill epoch-millisecond timestamps from the legacy DATETIME column.
    db.exec("UPDATE messages SET created_at = CAST(strftime('%s', timestamp) AS INTEGER) * 1000 WHERE created_at IS NULL AND timestamp IS NOT NULL");
  }
  const hasEditedAt = db.prepare("PRAGMA table_info(messages)").all().some(c => c.name === 'edited_at');
  if (!hasEditedAt) {
    db.exec('ALTER TABLE messages ADD COLUMN edited_at INTEGER');
  }
  const hasOwner = db.prepare("PRAGMA table_info(spaces)").all().some(c => c.name === 'owner_id');
  if (!hasOwner) {
    db.exec('ALTER TABLE spaces ADD COLUMN owner_id INTEGER');
  }
  const hasAvatar = db.prepare("PRAGMA table_info(users)").all().some(c => c.name === 'avatar_url');
  if (!hasAvatar) {
    db.exec('ALTER TABLE users ADD COLUMN avatar_url TEXT');
  }
  const hasChannelType = db.prepare("PRAGMA table_info(channels)").all().some(c => c.name === 'type');
  if (!hasChannelType) {
    db.exec("ALTER TABLE channels ADD COLUMN type TEXT NOT NULL DEFAULT 'text'");
  }
  const hasSpoiler = db.prepare("PRAGMA table_info(messages)").all().some(c => c.name === 'attachment_spoiler');
  if (!hasSpoiler) {
    db.exec('ALTER TABLE messages ADD COLUMN attachment_spoiler INTEGER NOT NULL DEFAULT 0');
  }
  const dmHasSpoiler = db.prepare("PRAGMA table_info(dm_messages)").all().some(c => c.name === 'attachment_spoiler');
  if (!dmHasSpoiler) {
    db.exec('ALTER TABLE dm_messages ADD COLUMN attachment_spoiler INTEGER NOT NULL DEFAULT 0');
  }
  // Albums: a JSON array of attachment URLs (attachment_url holds the first, for
  // back-compat and previews).
  const hasAttachments = db.prepare("PRAGMA table_info(messages)").all().some(c => c.name === 'attachments');
  if (!hasAttachments) {
    db.exec('ALTER TABLE messages ADD COLUMN attachments TEXT');
  }
  const dmHasAttachments = db.prepare("PRAGMA table_info(dm_messages)").all().some(c => c.name === 'attachments');
  if (!dmHasAttachments) {
    db.exec('ALTER TABLE dm_messages ADD COLUMN attachments TEXT');
  }
  // Optional server icon image (a /uploads path); falls back to name initials.
  const hasSpaceIcon = db.prepare("PRAGMA table_info(spaces)").all().some(c => c.name === 'icon_url');
  if (!hasSpaceIcon) {
    db.exec('ALTER TABLE spaces ADD COLUMN icon_url TEXT');
  }
  // Role-based permissions: per-server action thresholds (JSON) and per-channel
  // minimum ranks to view/post. Rank: member=1, admin=2, owner=3.
  const hasPerms = db.prepare("PRAGMA table_info(spaces)").all().some(c => c.name === 'permissions');
  if (!hasPerms) {
    db.exec('ALTER TABLE spaces ADD COLUMN permissions TEXT');
  }
  const chanCols = db.prepare("PRAGMA table_info(channels)").all();
  if (!chanCols.some(c => c.name === 'view_role')) {
    db.exec('ALTER TABLE channels ADD COLUMN view_role INTEGER NOT NULL DEFAULT 1');
  }
  if (!chanCols.some(c => c.name === 'post_role')) {
    db.exec('ALTER TABLE channels ADD COLUMN post_role INTEGER NOT NULL DEFAULT 1');
  }
  // Instance ("site") admins who manage registration.
  if (!db.prepare("PRAGMA table_info(users)").all().some(c => c.name === 'site_admin')) {
    db.exec('ALTER TABLE users ADD COLUMN site_admin INTEGER NOT NULL DEFAULT 0');
  }
  // Non-destructive framing: keep the original upload plus the crop box
  // (JSON {zoom,cx,cy}) alongside the displayed square, so an avatar or server
  // icon can be re-framed later without re-uploading.
  const addCol = (table, col, type) => {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
    }
  };
  addCol('users', 'avatar_original', 'TEXT');
  addCol('users', 'avatar_crop', 'TEXT');
  addCol('spaces', 'icon_original', 'TEXT');
  addCol('spaces', 'icon_crop', 'TEXT');
  // Registration invite codes + instance settings (e.g. registration mode).
  db.exec(`CREATE TABLE IF NOT EXISTS reg_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    created_by INTEGER,
    created_at INTEGER,
    expires_at INTEGER,
    max_uses INTEGER,
    uses INTEGER NOT NULL DEFAULT 0,
    revoked_at INTEGER
  )`);
  db.exec('CREATE TABLE IF NOT EXISTS site_settings (key TEXT PRIMARY KEY, value TEXT)');
  // Bootstrap: if there are users but none is a site admin, promote the earliest.
  const anyAdmin = db.prepare('SELECT 1 FROM users WHERE site_admin = 1 LIMIT 1').get();
  if (!anyAdmin) {
    const first = db.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get();
    if (first) db.prepare('UPDATE users SET site_admin = 1 WHERE id = ?').run(first.id);
  }
} catch (e) {
  console.error('Error migrating messages table:', e);
}

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
  manage_roles: 3,
};

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
}

// Whether a role rank may perform a server action.
function canDo(spaceId, role, action) {
  return roleRank(role) >= (getSpacePermissions(spaceId)[action] || 3);
}

function getChannelPerms(spaceName, channelName) {
  return db.prepare(`
    SELECT c.view_role AS view, c.post_role AS post
    FROM channels c JOIN spaces s ON c.space_id = s.id
    WHERE s.name = ? AND c.name = ?
  `).get(spaceName, channelName) || null;
}

function setChannelPerms(spaceName, channelName, viewRole, postRole) {
  const v = Math.min(3, Math.max(1, parseInt(viewRole, 10) || 1));
  // You can't post somewhere you can't see, so post threshold >= view threshold.
  const p = Math.min(3, Math.max(v, parseInt(postRole, 10) || 1));
  return db.prepare(`
    UPDATE channels SET view_role = ?, post_role = ?
    WHERE space_id = (SELECT id FROM spaces WHERE name = ?) AND name = ?
  `).run(v, p, spaceName, channelName).changes > 0;
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
  db.prepare('INSERT OR IGNORE INTO channels(space_id, name, type) VALUES (?, ?, ?)')
    .run(space.id, channelName, type === 'voice' ? 'voice' : 'text');
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

function getSpaceByName(name) {
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
  db.prepare('INSERT OR IGNORE INTO space_members(space_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)')
    .run(spaceId, userId, role, Date.now());
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
  return db.prepare('UPDATE space_members SET role = ? WHERE space_id = ? AND user_id = ?')
    .run(role, spaceId, userId).changes > 0;
}

function isMember(spaceId, userId) {
  return !!db.prepare('SELECT 1 FROM space_members WHERE space_id = ? AND user_id = ?').get(spaceId, userId);
}

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
    'SELECT name, type, view_role AS view, post_role AS post FROM channels WHERE space_id = ? ORDER BY id'
  );
  return spaces.map((s) => {
    const rank = roleRank(s.role);
    // Members only see channels their rank is allowed to view.
    const chans = channelStmt.all(s.id).filter((c) => rank >= (c.view || 1));
    const channelMeta = {};
    for (const c of chans) channelMeta[c.name] = { type: c.type, view: c.view || 1, post: c.post || 1 };
    return {
      name: s.name,
      icon: s.icon || null,
      iconOriginal: s.iconOriginal || null,
      iconCrop: s.iconCrop ? JSON.parse(s.iconCrop) : null,
      role: s.role,
      permissions: getSpacePermissions(s.id),
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

function storeMessage(spaceName, channelName, content, authorId, attachments = [], spoiler = false) {
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
    'INSERT INTO messages(channel_id, content, author_id, attachment_url, attachments, attachment_spoiler, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(channel.id, content, authorId || null, first, json, spoiler ? 1 : 0, createdAt);
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
         u.avatar_url AS authorAvatar
  FROM messages m
  JOIN channels c ON m.channel_id = c.id
  JOIN spaces s ON c.space_id = s.id
  LEFT JOIN users u ON m.author_id = u.id
`;

function getMessages(spaceName, channelName, limit = 20, offset = 0) {
  const rows = db.prepare(`${MESSAGE_SELECT}
    WHERE s.name = ? AND c.name = ?
    ORDER BY m.id DESC
    LIMIT ? OFFSET ?
  `).all(spaceName, channelName, limit, offset).reverse();
  return attachReactions(rows.map(hydrateAttachments));
}

// Messages newer than a given id, oldest-first — used to backfill gaps after a
// client reconnects so no messages are missed during a network blip.
function getMessagesAfter(spaceName, channelName, afterId, limit = 200) {
  const rows = db.prepare(`${MESSAGE_SELECT}
    WHERE s.name = ? AND c.name = ? AND m.id > ?
    ORDER BY m.id ASC
    LIMIT ?
  `).all(spaceName, channelName, afterId, limit);
  return attachReactions(rows.map(hydrateAttachments));
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
function getMessageLocation(messageId) {
  return db.prepare(`
    SELECT s.name AS space, c.name AS channel
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

// Unread message counts per channel across all of the user's servers.
function getUnreadCounts(userId) {
  return db.prepare(`
    SELECT s.name AS space, c.name AS channel, COUNT(m.id) AS count
    FROM space_members sm
    JOIN spaces s ON sm.space_id = s.id
    JOIN channels c ON c.space_id = s.id
    LEFT JOIN read_state rs ON rs.user_id = sm.user_id AND rs.space = s.name AND rs.channel = c.name
    LEFT JOIN messages m ON m.channel_id = c.id AND m.id > COALESCE(rs.last_read_id, 0)
    WHERE sm.user_id = ?
    GROUP BY s.name, c.name
    HAVING count > 0
  `).all(userId);
}

// Record which server members a message mentions (only real members count).
// Returns the resolved usernames so the sender's client can highlight them.
function addMentions(messageId, spaceId, usernames) {
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
    }
  }
  return resolved;
}

// Unread mentions of the user, per channel (mentions in messages newer than the
// user's read marker for that channel).
function getMentionCounts(userId) {
  return db.prepare(`
    SELECT s.name AS space, c.name AS channel, COUNT(m.id) AS count
    FROM mentions mn
    JOIN messages m ON mn.message_id = m.id
    JOIN channels c ON m.channel_id = c.id
    JOIN spaces s ON c.space_id = s.id
    LEFT JOIN read_state rs ON rs.user_id = ? AND rs.space = s.name AND rs.channel = c.name
    WHERE mn.user_id = ? AND m.id > COALESCE(rs.last_read_id, 0)
    GROUP BY s.name, c.name
    HAVING count > 0
  `).all(userId, userId);
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
         u.avatar_url AS authorAvatar
  FROM dm_messages m
  JOIN users u ON m.author_id = u.id
`;

function storeDm(fromId, toId, content, attachments = [], spoiler = false) {
  const [a, b] = dmPair(fromId, toId);
  const list = Array.isArray(attachments) ? attachments : (attachments ? [attachments] : []);
  const first = list[0] || null;
  const json = list.length ? JSON.stringify(list) : null;
  const createdAt = Date.now();
  const info = db.prepare(
    'INSERT INTO dm_messages(user_a, user_b, author_id, content, attachment_url, attachments, attachment_spoiler, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(a, b, fromId, content, first, json, spoiler ? 1 : 0, createdAt);
  return { id: info.lastInsertRowid, timestamp: createdAt };
}

function getDmMessages(userId, otherId, limit = 50, offset = 0) {
  const [a, b] = dmPair(userId, otherId);
  return db.prepare(`${DM_SELECT} WHERE m.user_a = ? AND m.user_b = ? ORDER BY m.id DESC LIMIT ? OFFSET ?`)
    .all(a, b, limit, offset).reverse().map(hydrateAttachments);
}

function getDmMessagesAfter(userId, otherId, afterId, limit = 200) {
  const [a, b] = dmPair(userId, otherId);
  return db.prepare(`${DM_SELECT} WHERE m.user_a = ? AND m.user_b = ? AND m.id > ? ORDER BY m.id ASC LIMIT ?`)
    .all(a, b, afterId, limit).map(hydrateAttachments);
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
  const channels = db.prepare(`
    SELECT m.id, m.content,
           COALESCE(m.created_at, CAST(strftime('%s', m.timestamp) AS INTEGER) * 1000) AS timestamp,
           u.username AS author, u.avatar_url AS authorAvatar,
           s.name AS space, c.name AS channel
    FROM messages m
    JOIN channels c ON m.channel_id = c.id
    JOIN spaces s ON c.space_id = s.id
    JOIN space_members sm ON sm.space_id = s.id AND sm.user_id = ?
    LEFT JOIN users u ON m.author_id = u.id
    WHERE m.content LIKE ? ESCAPE '\\'
    ORDER BY m.id DESC
    LIMIT ?
  `).all(userId, like, limit);

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

function getUserByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}

function getUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email);
}

function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function setUserPassword(userId, passwordHash, salt) {
  return db.prepare('UPDATE users SET password_hash = ?, salt = ? WHERE id = ?')
    .run(passwordHash, salt, userId).changes > 0;
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

module.exports = {
  createSpace,
  createChannel,
  deleteSpace,
  deleteChannel,
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
  getSpaceMembers,
  createInvite,
  getInvite,
  incrementInviteUses,
  storeMessage,
  editMessage,
  deleteMessage,
  getMessages,
  getMessagesAfter,
  toggleReaction,
  getReaction,
  isMessageInChannel,
  getMessageLocation,
  getCoMemberIds,
  markRead,
  getUnreadCounts,
  markSpaceRead,
  addMentions,
  getMentionCounts,
  storeDm,
  getDmMessages,
  getDmMessagesAfter,
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
  removeFriendRequest,
  addFriends,
  removeFriend,
  getFriends,
};
