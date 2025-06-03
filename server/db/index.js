const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, 'disgourd.db');
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
    content TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(channel_id) REFERENCES channels(id) ON DELETE CASCADE
  );
`);

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

function storeMessage(spaceName, channelName, content) {
  createChannel(spaceName, channelName);
  const channel = db.prepare(`
    SELECT c.id FROM channels c
    JOIN spaces s ON c.space_id = s.id
    WHERE s.name = ? AND c.name = ?
  `).get(spaceName, channelName);
  if (channel) {
    db.prepare('INSERT INTO messages(channel_id, content) VALUES (?, ?)').run(channel.id, content);
  }
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

module.exports = {
  createSpace,
  createChannel,
  deleteSpace,
  deleteChannel,
  storeMessage,
  getState,
};
