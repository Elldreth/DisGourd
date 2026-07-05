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
} catch (e) {
  console.error('Error migrating messages table:', e);
}

function createSpace(name) {
  const stmt = db.prepare('INSERT OR IGNORE INTO spaces(name) VALUES (?)');
  stmt.run(name);
}

function createChannel(spaceName, channelName) {
  createSpace(spaceName);
  const space = db.prepare('SELECT id FROM spaces WHERE name = ?').get(spaceName);
  const stmt = db.prepare('INSERT OR IGNORE INTO channels(space_id, name) VALUES (?, ?)');
  stmt.run(space.id, channelName);
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

function renameSpace(oldName, newName) {
  const stmt = db.prepare('UPDATE spaces SET name = ? WHERE name = ?');
  try {
    return stmt.run(newName, oldName).changes > 0;
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT') return false;
    throw e;
  }
}

function renameChannel(spaceName, oldChannelName, newChannelName) {
  const stmt = db.prepare(`
    UPDATE channels SET name = ? WHERE id IN (
      SELECT c.id FROM channels c
      JOIN spaces s ON c.space_id = s.id
      WHERE s.name = ? AND c.name = ?
    )`);
  try {
    return stmt.run(newChannelName, spaceName, oldChannelName).changes > 0;
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT') return false;
    throw e;
  }
}

// ---- Spaces: ownership, membership, invites ----

function getSpaceByName(name) {
  return db.prepare('SELECT id, name, owner_id FROM spaces WHERE name = ?').get(name);
}

function getSpaceById(id) {
  return db.prepare('SELECT id, name, owner_id FROM spaces WHERE id = ?').get(id);
}

function channelExists(spaceName, channelName) {
  return !!db.prepare(`
    SELECT 1 FROM channels c
    JOIN spaces s ON c.space_id = s.id
    WHERE s.name = ? AND c.name = ?
  `).get(spaceName, channelName);
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

function isMember(spaceId, userId) {
  return !!db.prepare('SELECT 1 FROM space_members WHERE space_id = ? AND user_id = ?').get(spaceId, userId);
}

// Spaces the user belongs to, each with its channels and the user's role.
function getUserSpaces(userId) {
  const spaces = db.prepare(`
    SELECT s.id, s.name, sm.role
    FROM space_members sm
    JOIN spaces s ON sm.space_id = s.id
    WHERE sm.user_id = ?
    ORDER BY s.name COLLATE NOCASE
  `).all(userId);
  const channelStmt = db.prepare('SELECT name FROM channels WHERE space_id = ? ORDER BY id');
  return spaces.map((s) => ({
    name: s.name,
    role: s.role,
    channels: channelStmt.all(s.id).map((c) => c.name),
  }));
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

function storeMessage(spaceName, channelName, content, authorId, attachmentUrl) {
  createChannel(spaceName, channelName);
  const channel = db.prepare(`
    SELECT c.id FROM channels c
    JOIN spaces s ON c.space_id = s.id
    WHERE s.name = ? AND c.name = ?
  `).get(spaceName, channelName);
  if (!channel) return null;
  const createdAt = Date.now();
  const info = db.prepare(
    'INSERT INTO messages(channel_id, content, author_id, attachment_url, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(channel.id, content, authorId || null, attachmentUrl || null, createdAt);
  return { id: info.lastInsertRowid, timestamp: createdAt };
}

// Canonical message projection shared by history and backfill queries.
// `timestamp` is always epoch milliseconds; `attachment` is the stored URL.
const MESSAGE_SELECT = `
  SELECT m.id,
         m.content,
         m.attachment_url AS attachment,
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
  return attachReactions(rows);
}

// Messages newer than a given id, oldest-first — used to backfill gaps after a
// client reconnects so no messages are missed during a network blip.
function getMessagesAfter(spaceName, channelName, afterId, limit = 200) {
  const rows = db.prepare(`${MESSAGE_SELECT}
    WHERE s.name = ? AND c.name = ? AND m.id > ?
    ORDER BY m.id ASC
    LIMIT ?
  `).all(spaceName, channelName, afterId, limit);
  return attachReactions(rows);
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
         COALESCE(m.created_at, 0) AS timestamp,
         m.edited_at AS editedAt,
         m.author_id AS authorId,
         u.username AS author,
         u.avatar_url AS authorAvatar
  FROM dm_messages m
  JOIN users u ON m.author_id = u.id
`;

function storeDm(fromId, toId, content, attachmentUrl) {
  const [a, b] = dmPair(fromId, toId);
  const createdAt = Date.now();
  const info = db.prepare(
    'INSERT INTO dm_messages(user_a, user_b, author_id, content, attachment_url, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(a, b, fromId, content, attachmentUrl || null, createdAt);
  return { id: info.lastInsertRowid, timestamp: createdAt };
}

function getDmMessages(userId, otherId, limit = 50, offset = 0) {
  const [a, b] = dmPair(userId, otherId);
  return db.prepare(`${DM_SELECT} WHERE m.user_a = ? AND m.user_b = ? ORDER BY m.id DESC LIMIT ? OFFSET ?`)
    .all(a, b, limit, offset).reverse();
}

function getDmMessagesAfter(userId, otherId, afterId, limit = 200) {
  const [a, b] = dmPair(userId, otherId);
  return db.prepare(`${DM_SELECT} WHERE m.user_a = ? AND m.user_b = ? AND m.id > ? ORDER BY m.id ASC LIMIT ?`)
    .all(a, b, afterId, limit);
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

function getState() {
  const spaces = db.prepare('SELECT id, name FROM spaces').all();
  const channelStmt = db.prepare('SELECT name FROM channels WHERE space_id = ?');
  const result = {};
  for (const space of spaces) {
    result[space.name] = { channels: {} };
    const channels = channelStmt.all(space.id);
    for (const channel of channels) {
      result[space.name].channels[channel.name] = {};
    }
  }
  return result;
}

function createUser(username, email, passwordHash, salt) {
  const stmt = db.prepare('INSERT INTO users(username, email, password_hash, salt) VALUES (?, ?, ?, ?)');
  return stmt.run(username, email, passwordHash, salt).lastInsertRowid;
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

function setUserAvatar(userId, avatarUrl) {
  return db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?')
    .run(avatarUrl || null, userId).changes > 0;
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
  renameSpace,
  renameChannel,
  getSpaceByName,
  getSpaceById,
  channelExists,
  createSpaceOwned,
  addMember,
  removeMember,
  getMemberRole,
  isMember,
  getUserSpaces,
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
  getDmConversations,
  markDmRead,
  getDmUnreadCounts,
  searchMessages,
  getState,
  createUser,
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
