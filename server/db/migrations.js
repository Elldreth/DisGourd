// Versioned schema migrations. Each runs once, in order, inside its own
// transaction, and records its version in `PRAGMA user_version` in that same
// transaction. A failing migration rolls back and throws, so the server
// refuses to start on a half-upgraded database instead of limping along.
//
// To change the schema, append a migration with the next version number.
// Never edit one that has shipped.

const MIGRATIONS = [
  {
    version: 1,
    name: 'baseline',
    // Everything that existed before versioning. Idempotent, because databases
    // at user_version 0 can be in any historical state: brand new, or created
    // by an old build that predates some of these columns.
    up(db) {
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

      // Columns and tables added over time, for databases created before them.
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
    },
  },
  {
    version: 2,
    name: 'hot-path indexes',
    up(db) {
      // Channel history (and ?before= paging), DM history, mention counts.
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id, id);
        CREATE INDEX IF NOT EXISTS idx_dm_pair ON dm_messages(user_a, user_b, id);
        CREATE INDEX IF NOT EXISTS idx_mentions_user ON mentions(user_id);
      `);
    },
  },
  {
    version: 3,
    name: 'message replies',
    up(db) {
      // The message being replied to. A plain id, not a foreign key, so that
      // when the original is deleted the reply can still say "deleted" instead
      // of silently losing its quote (ids are AUTOINCREMENT, never reused).
      // dm_messages gets it now too, for DM replies (P2-10).
      db.exec('ALTER TABLE messages ADD COLUMN reply_to INTEGER');
      db.exec('ALTER TABLE dm_messages ADD COLUMN reply_to INTEGER');
    },
  },
  {
    version: 4,
    name: 'link previews',
    up(db) {
      // link_previews caches one card per URL (data is the card JSON; ok = 0
      // remembers a failed fetch so it isn't retried every message).
      // message_embeds / dm_message_embeds say which cards a message shows, in
      // order; they go when the message does.
      db.exec(`
        CREATE TABLE link_previews (
          url TEXT PRIMARY KEY,
          data TEXT,
          fetched_at INTEGER NOT NULL,
          ok INTEGER NOT NULL
        );
        CREATE TABLE message_embeds (
          message_id INTEGER NOT NULL,
          url TEXT NOT NULL,
          position INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY(message_id, url),
          FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE
        );
        CREATE TABLE dm_message_embeds (
          message_id INTEGER NOT NULL,
          url TEXT NOT NULL,
          position INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY(message_id, url),
          FOREIGN KEY(message_id) REFERENCES dm_messages(id) ON DELETE CASCADE
        );
      `);
    },
  },
  {
    version: 5,
    name: 'presence modes',
    up(db) {
      // The presence a user chose: online | idle | dnd | invisible. What others
      // see is derived from this and whether they're connected.
      db.exec("ALTER TABLE users ADD COLUMN presence TEXT NOT NULL DEFAULT 'online'");
    },
  },
  {
    version: 6,
    name: 'custom status',
    up(db) {
      // A short custom status (up to 80 characters) with an optional emoji,
      // cleared at status_expires_at (ms) if set.
      db.exec('ALTER TABLE users ADD COLUMN status_text TEXT');
      db.exec('ALTER TABLE users ADD COLUMN status_emoji TEXT');
      db.exec('ALTER TABLE users ADD COLUMN status_expires_at INTEGER');
    },
  },
  {
    version: 7,
    name: 'pinned messages',
    up(db) {
      // One row per pinned channel message; it goes when the message does.
      db.exec(`
        CREATE TABLE pins (
          message_id INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
          channel_id INTEGER NOT NULL,
          pinned_by INTEGER,
          pinned_at INTEGER NOT NULL
        );
        CREATE INDEX idx_pins_channel ON pins(channel_id, pinned_at);
      `);
    },
  },
];

const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

// Bring `db` up to the newest version. Throws (after rolling back) if a
// migration fails; earlier migrations in the same run stay applied.
function runMigrations(db, migrations = MIGRATIONS) {
  const current = db.pragma('user_version', { simple: true });
  for (const m of migrations) {
    if (m.version <= current) continue;
    try {
      db.transaction(() => {
        m.up(db);
        db.pragma(`user_version = ${m.version}`);
      })();
    } catch (err) {
      const wrapped = new Error(`Database migration ${m.version} (${m.name}) failed: ${err.message}`);
      wrapped.cause = err;
      throw wrapped;
    }
  }
}

module.exports = { MIGRATIONS, LATEST_VERSION, runMigrations };
