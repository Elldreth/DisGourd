// Emoji data for the picker: loaded on demand (its own chunk, ~570 KB of
// JSON), searched by name, tag and shortcode, plus the "Recent" list.

// Categories in picker order, with a representative emoji for the tab. The
// numbers are emojibase's group ids; group 2 (skin-tone swatches etc.) is
// left out.
export const EMOJI_GROUPS = [
  { id: 0, name: 'Smileys & emotion', icon: '😀' },
  { id: 1, name: 'People & body', icon: '👋' },
  { id: 3, name: 'Animals & nature', icon: '🐻' },
  { id: 4, name: 'Food & drink', icon: '🍔' },
  { id: 5, name: 'Travel & places', icon: '🚗' },
  { id: 6, name: 'Activities', icon: '⚽' },
  { id: 7, name: 'Objects', icon: '💡' },
  { id: 8, name: 'Symbols', icon: '❤️' },
  { id: 9, name: 'Flags', icon: '🏁' },
];
const SHOWN_GROUPS = new Set(EMOJI_GROUPS.map((g) => g.id));

let loading = null;

// [{ emoji, label, group, tags, shortcodes }] in Unicode order. Cached.
export function loadEmoji() {
  if (!loading) {
    loading = Promise.all([
      import('emojibase-data/en/compact.json'),
      import('emojibase-data/en/shortcodes/emojibase.json'),
    ])
      .then(([data, codes]) => {
        const rows = data.default || data;
        const shortcodes = codes.default || codes;
        return rows
          .filter((e) => SHOWN_GROUPS.has(e.group))
          .sort((a, b) => a.order - b.order)
          .map((e) => {
            const sc = shortcodes[e.hexcode];
            return {
              emoji: e.unicode,
              label: e.label,
              group: e.group,
              tags: e.tags || [],
              shortcodes: sc ? [].concat(sc) : [],
            };
          });
      })
      .catch((err) => {
        loading = null; // let the next open try again
        throw err;
      });
  }
  return loading;
}

// Emoji matching `query`, best first: an exact name or shortcode, then names
// starting with it, then names, shortcodes or tags containing it.
export function searchEmoji(list, query) {
  const q = query.trim().toLowerCase().replace(/^:|:$/g, '');
  if (!q) return [];
  const scored = [];
  for (const e of list) {
    const label = e.label.toLowerCase();
    let score = 0;
    if (label === q || e.shortcodes.includes(q)) score = 4;
    else if (label.startsWith(q) || e.shortcodes.some((s) => s.startsWith(q))) score = 3;
    else if (label.split(/[\s:-]+/).some((w) => w.startsWith(q))) score = 2;
    else if (label.includes(q) || e.shortcodes.some((s) => s.includes(q)) || e.tags.some((t) => t.startsWith(q))) score = 1;
    if (score) scored.push([score, e]);
  }
  // Stable sort keeps Unicode order within a score.
  return scored.sort((a, b) => b[0] - a[0]).map(([, e]) => e);
}

// ---- Custom server emoji (P2-19) ----
// Picker items for a server's own emoji: typed as :name:, reacted as <:name:id>.
export function customEmojiItems(list) {
  return (list || []).map((e) => ({
    emoji: `:${e.name}:`,
    label: `:${e.name}:`,
    shortcodes: [e.name],
    tags: [],
    group: -1,
    custom: { id: e.id, name: e.name, url: e.url },
    reaction: `<:${e.name}:${e.id}>`,
  }));
}

// The parts of a <:name:id> reaction token, or null for a normal emoji.
export function parseEmojiToken(value) {
  const m = /^<:([a-z0-9_]{2,32}):(\d+)>$/.exec(String(value || ''));
  return m ? { name: m[1], id: Number(m[2]) } : null;
}

// name -> url, for rendering :name: in messages.
export function emojiLookup(list) {
  const map = new Map();
  for (const e of list || []) map.set(e.name, e.url);
  return map;
}

// ---- Recently used (this browser) ----
const RECENT_KEY = 'disgourd.recentEmoji';
const RECENT_MAX = 24;

export function getRecentEmoji() {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

export function addRecentEmoji(emoji) {
  const next = [emoji, ...getRecentEmoji().filter((e) => e !== emoji)].slice(0, RECENT_MAX);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* storage full or blocked: recent just won't persist */
  }
  return next;
}

// Insert `emoji` into `text` replacing the selection [start, end) (or at the
// end when the caret is unknown). Returns the new text and where the caret
// goes (just after the emoji).
export function insertAtCaret(text, start, end, emoji) {
  const s = start == null ? text.length : start;
  const e = end == null ? s : end;
  return { text: text.slice(0, s) + emoji + text.slice(e), caret: s + emoji.length };
}
