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
  {
    version: 8,
    name: 'threads',
    up(db) {
      // A thread is a hidden channel (type 'thread', named ~t<root id>) under a
      // text channel. It goes with its parent; deleting the root message keeps it.
      db.exec(`
        ALTER TABLE channels ADD COLUMN parent_id INTEGER REFERENCES channels(id) ON DELETE CASCADE;
        ALTER TABLE channels ADD COLUMN root_message_id INTEGER;
        ALTER TABLE channels ADD COLUMN thread_name TEXT;
        ALTER TABLE channels ADD COLUMN created_by INTEGER;
        ALTER TABLE channels ADD COLUMN last_activity_at INTEGER;
        ALTER TABLE channels ADD COLUMN archived_at INTEGER;
        CREATE UNIQUE INDEX idx_threads_root ON channels(root_message_id) WHERE root_message_id IS NOT NULL;
        CREATE INDEX idx_threads_parent ON channels(parent_id, last_activity_at);
      `);
    },
  },
  {
    version: 9,
    name: 'thread follows',
    up(db) {
      // Who follows which thread (a channel row of type 'thread'). Followed
      // threads count as unread and notify; the row goes with the user or thread.
      db.exec(`
        CREATE TABLE thread_follows (
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
          followed_at INTEGER NOT NULL,
          PRIMARY KEY (user_id, channel_id)
        );
        CREATE INDEX idx_thread_follows_channel ON thread_follows(channel_id);
      `);
    },
  },
  {
    version: 10,
    name: 'custom server emoji',
    up(db) {
      // A server's own emoji: an uploaded image under a short name, used as
      // :name: in that server. Rows go with the server.
      db.exec(`
        CREATE TABLE space_emoji (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          url TEXT NOT NULL,
          created_by INTEGER,
          created_at INTEGER NOT NULL,
          UNIQUE (space_id, name)
        );
      `);
    },
  },
  {
    version: 11,
    name: 'push subscriptions',
    up(db) {
      // A browser's Web Push subscription (P2-18b). `previews`: whether its
      // notifications may carry message text. Rows go with the user.
      db.exec(`
        CREATE TABLE push_subscriptions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          endpoint TEXT NOT NULL UNIQUE,
          p256dh TEXT NOT NULL,
          auth TEXT NOT NULL,
          previews INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX idx_push_user ON push_subscriptions(user_id);
      `);
    },
  },
  {
    version: 12,
    name: 'roles',
    up(db) {
      // Custom roles (P2-21a). A server's roles, who holds which, and per-channel
      // allow/deny overrides. Seeded from the fixed tiers by db/index.js
      // (syncSpaceRoles) right after this migration runs; until P2-21b the old
      // tier columns stay the ones the checks read.
      db.exec(`
        CREATE TABLE roles (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          color TEXT,
          position INTEGER NOT NULL DEFAULT 0,
          permissions TEXT NOT NULL DEFAULT '[]',
          is_default INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          UNIQUE (space_id, name)
        );
        CREATE INDEX idx_roles_space ON roles(space_id, position);
        CREATE TABLE member_roles (
          space_id INTEGER NOT NULL,
          user_id INTEGER NOT NULL,
          role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
          PRIMARY KEY (user_id, role_id),
          FOREIGN KEY (space_id, user_id) REFERENCES space_members(space_id, user_id) ON DELETE CASCADE
        );
        CREATE INDEX idx_member_roles_member ON member_roles(space_id, user_id);
        CREATE TABLE channel_role_overrides (
          channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
          role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
          view INTEGER,
          post INTEGER,
          PRIMARY KEY (channel_id, role_id)
        );
      `);
    },
  },
  {
    version: 13,
    name: 'imagine core',
    up(db) {
      // /imagine (P2-20a): bot accounts, 18+ channels, per-server settings and
      // the generation jobs (who asked, where, which engine, how it went).
      db.exec(`
        ALTER TABLE users ADD COLUMN is_bot INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE channels ADD COLUMN nsfw INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE spaces ADD COLUMN imagine_enabled INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE spaces ADD COLUMN imagine_daily_limit INTEGER;
        CREATE TABLE imagine_jobs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          space_id INTEGER REFERENCES spaces(id) ON DELETE CASCADE,
          channel_id INTEGER REFERENCES channels(id) ON DELETE SET NULL,
          message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
          engine TEXT NOT NULL,
          model TEXT,
          prompt TEXT NOT NULL,
          shape TEXT NOT NULL,
          quality TEXT NOT NULL,
          permissive INTEGER NOT NULL DEFAULT 0,
          cost REAL NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'queued',
          error TEXT,
          created_at INTEGER NOT NULL,
          started_at INTEGER,
          finished_at INTEGER
        );
        CREATE INDEX idx_imagine_jobs_user ON imagine_jobs(user_id, created_at);
      `);
    },
  },
  {
    version: 14,
    name: 'channel topics',
    up(db) {
      // A short description per channel, shown in its header (P3-20a).
      db.exec('ALTER TABLE channels ADD COLUMN topic TEXT');
    },
  },
  {
    version: 15,
    name: 'hidden link previews',
    up(db) {
      // A message whose link cards were removed keeps them off, even when
      // it's edited (P3-20c).
      db.exec(`
        ALTER TABLE messages ADD COLUMN embeds_hidden INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE dm_messages ADD COLUMN embeds_hidden INTEGER NOT NULL DEFAULT 0;
      `);
    },
  },
  {
    version: 16,
    name: 'imagine upscale jobs',
    up(db) {
      // P3-29: what a job did ('generate' or 'upscale') and, for an upscale,
      // the image it started from (so a Retry can upscale it again).
      db.exec(`
        ALTER TABLE imagine_jobs ADD COLUMN kind TEXT NOT NULL DEFAULT 'generate';
        ALTER TABLE imagine_jobs ADD COLUMN source_url TEXT;
      `);
    },
  },
  {
    version: 17,
    name: 'channel categories',
    up(db) {
      // P3-25a: named categories in an order, and each channel's category and
      // place. Every existing server gets "Text channels" and "Voice channels"
      // holding what it has now (in creation order), so nothing looks
      // different until someone rearranges. Threads stay out of it.
      db.exec(`
        CREATE TABLE channel_categories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          position INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX idx_categories_space ON channel_categories(space_id, position);
        ALTER TABLE channels ADD COLUMN category_id INTEGER REFERENCES channel_categories(id) ON DELETE SET NULL;
        ALTER TABLE channels ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
      `);
      const addCategory = db.prepare('INSERT INTO channel_categories(space_id, name, position) VALUES (?, ?, ?)');
      const channelsOf = db.prepare("SELECT id FROM channels WHERE space_id = ? AND type = ? ORDER BY id");
      const place = db.prepare('UPDATE channels SET category_id = ?, position = ? WHERE id = ?');
      for (const { id: spaceId } of db.prepare('SELECT id FROM spaces').all()) {
        [['text', 'Text channels'], ['voice', 'Voice channels']].forEach(([type, name], i) => {
          const categoryId = Number(addCategory.run(spaceId, name, i).lastInsertRowid);
          channelsOf.all(spaceId, type).forEach((c, pos) => place.run(categoryId, pos, c.id));
        });
      }
    },
  },
  {
    version: 18,
    name: 'category permissions',
    up(db) {
      // P3-25d: per-role access on a category, the same shape as a channel's.
      // Copied onto channels created in or moved into it; never synced.
      db.exec(`
        CREATE TABLE category_role_overrides (
          category_id INTEGER NOT NULL REFERENCES channel_categories(id) ON DELETE CASCADE,
          role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
          view INTEGER,
          post INTEGER,
          PRIMARY KEY (category_id, role_id)
        );
      `);
    },
  },
  {
    version: 19,
    name: 'imagine variation strength',
    up(db) {
      // P3-36a: a variation's img2img strength (so a Retry repeats it).
      db.exec('ALTER TABLE imagine_jobs ADD COLUMN strength REAL');
    },
  },
  {
    version: 20,
    name: 'moderation log',
    up(db) {
      // P3-26a: who did what to whom. Names are kept as they were at the time,
      // so entries still read right after a rename or a deleted account.
      db.exec(`
        CREATE TABLE mod_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
          actor_id INTEGER,
          actor_name TEXT,
          target_id INTEGER,
          target_name TEXT,
          action TEXT NOT NULL,
          reason TEXT,
          details TEXT,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX mod_log_space ON mod_log(space_id, id);
      `);
    },
  },
  {
    version: 21,
    name: 'bans',
    up(db) {
      // P3-26b: who is banned from which server. Per account, kept until unbanned.
      db.exec(`
        CREATE TABLE bans (
          space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          actor_id INTEGER,
          reason TEXT,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (space_id, user_id)
        );
      `);
      // The new "Ban members" permission goes to each server's seeded Admin role.
      const admins = db.prepare("SELECT id, permissions FROM roles WHERE name = 'Admin' AND is_default = 0").all();
      const save = db.prepare('UPDATE roles SET permissions = ? WHERE id = ?');
      for (const r of admins) {
        let list = [];
        try { list = JSON.parse(r.permissions) || []; } catch { list = []; }
        if (!list.includes('ban_members')) save.run(JSON.stringify([...list, 'ban_members']), r.id);
      }
    },
  },
  {
    version: 22,
    name: 'timeouts',
    up(db) {
      // P3-26c: a timeout is an end time (ms); nothing has to lift it.
      db.exec('ALTER TABLE space_members ADD COLUMN timeout_until INTEGER');
      db.exec('ALTER TABLE space_members ADD COLUMN timeout_reason TEXT');
      // "Time out members" goes to each server's seeded Admin role.
      const admins = db.prepare("SELECT id, permissions FROM roles WHERE name = 'Admin' AND is_default = 0").all();
      const save = db.prepare('UPDATE roles SET permissions = ? WHERE id = ?');
      for (const r of admins) {
        let list = [];
        try { list = JSON.parse(r.permissions) || []; } catch { list = []; }
        if (!list.includes('timeout_members')) save.run(JSON.stringify([...list, 'timeout_members']), r.id);
      }
    },
  },
  {
    version: 23,
    name: 'slow mode',
    up(db) {
      // P3-26d: seconds between one person's posts in a channel (0 = off).
      // Threads use their parent's.
      db.exec('ALTER TABLE channels ADD COLUMN slowmode_seconds INTEGER NOT NULL DEFAULT 0');
    },
  },
  {
    version: 24,
    name: 'edit history',
    up(db) {
      // P3-27: each text a message had before an edit, with when it was
      // written. They go when the message does.
      db.exec(`
        CREATE TABLE message_versions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
          content TEXT NOT NULL,
          written_at INTEGER
        );
        CREATE INDEX message_versions_message ON message_versions(message_id, id);
        CREATE TABLE dm_message_versions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          message_id INTEGER NOT NULL REFERENCES dm_messages(id) ON DELETE CASCADE,
          content TEXT NOT NULL,
          written_at INTEGER
        );
        CREATE INDEX dm_message_versions_message ON dm_message_versions(message_id, id);
      `);
    },
  },
  {
    version: 25,
    name: 'token version',
    up(db) {
      // P6-02: sign-in tokens carry this number; changing the password bumps
      // it, so every older token stops working. Existing tokens (no number)
      // count as 0, so nobody is signed out by the upgrade.
      db.exec('ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0');
    },
  },
  {
    version: 26,
    name: 'message reports',
    up(db) {
      // P9-01: a member flags a message for the server's moderators. The
      // author, channel and the start of the message are copied, so a report
      // still reads right after the message is deleted.
      db.exec(`
        CREATE TABLE reports (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          space_id INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
          message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
          channel TEXT NOT NULL,
          author_id INTEGER,
          author_name TEXT,
          reporter_id INTEGER,
          reporter_name TEXT,
          reason TEXT NOT NULL,
          note TEXT,
          excerpt TEXT,
          status TEXT NOT NULL DEFAULT 'open',
          resolved_by TEXT,
          resolution TEXT,
          created_at INTEGER NOT NULL,
          resolved_at INTEGER
        );
        CREATE INDEX reports_space ON reports(space_id, status, id);
      `);
    },
  },
  {
    version: 27,
    name: 'sessions',
    up(db) {
      // P9-03: one row per signed-in device, so they can be listed and signed
      // out. Tokens carry the id; `device` is a label like "Chrome on Windows"
      // (the User-Agent itself isn't kept, nor any IP address).
      db.exec(`
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          device TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          last_seen_at INTEGER NOT NULL
        );
        CREATE INDEX sessions_user ON sessions(user_id, last_seen_at);
      `);
    },
  },
  {
    version: 28,
    name: 'imagine style',
    up(db) {
      // P9-04a: which ComfyUI style made an image, so Variations, Upscale and
      // Retry use it again.
      db.exec('ALTER TABLE imagine_jobs ADD COLUMN preset TEXT');
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
