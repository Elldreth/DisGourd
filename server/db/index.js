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
         m.author_id AS authorId,
         u.username AS author
  FROM messages m
  JOIN channels c ON m.channel_id = c.id
  JOIN spaces s ON c.space_id = s.id
  LEFT JOIN users u ON m.author_id = u.id
`;

function getMessages(spaceName, channelName, limit = 20, offset = 0) {
  return db.prepare(`${MESSAGE_SELECT}
    WHERE s.name = ? AND c.name = ?
    ORDER BY m.id DESC
    LIMIT ? OFFSET ?
  `).all(spaceName, channelName, limit, offset).reverse();
}

// Messages newer than a given id, oldest-first — used to backfill gaps after a
// client reconnects so no messages are missed during a network blip.
function getMessagesAfter(spaceName, channelName, afterId, limit = 200) {
  return db.prepare(`${MESSAGE_SELECT}
    WHERE s.name = ? AND c.name = ? AND m.id > ?
    ORDER BY m.id ASC
    LIMIT ?
  `).all(spaceName, channelName, afterId, limit);
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
  storeMessage,
  getMessages,
  getMessagesAfter,
  getState,
  createUser,
  getUserByUsername,
  getUserByEmail,
  getUserById,
  setUserPassword,
  createFriendRequest,
  getIncomingFriendRequests,
  removeFriendRequest,
  addFriends,
  removeFriend,
  getFriends,
};
