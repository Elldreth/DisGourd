// Small presentation helpers shared across components.

// Role hierarchy: member < admin < owner. Permissions are "minimum rank to act".
export const ROLE_RANK = { member: 1, admin: 2, owner: 3 };
export const roleRank = (role) => ROLE_RANK[role] || 0;
// The position the server reports for an owner (above every role).
export const OWNER_POSITION = 1e9;
// Server actions the owner can gate, with friendly labels (order = display order).
export const PERMISSION_ACTIONS = [
  { key: 'create_channel', label: 'Create channels' },
  { key: 'delete_channel', label: 'Delete channels' },
  { key: 'invite', label: 'Invite people' },
  { key: 'kick', label: 'Remove members' },
  { key: 'ban_members', label: 'Ban members' },
  { key: 'timeout_members', label: 'Time out members' },
  { key: 'delete_others_messages', label: "Delete others' messages" },
  { key: 'pin_messages', label: 'Pin messages' },
  { key: 'edit_server', label: 'Edit server (name, icon)' },
  { key: 'manage_emoji', label: 'Manage server emoji' },
  { key: 'manage_roles', label: 'Manage roles' },
  { key: 'generate_images', label: 'Generate images (/imagine)' },
];
// The same permissions grouped for the Roles screen (P5-04), in display order.
export const PERMISSION_GROUPS = [
  { label: 'Channels', keys: ['create_channel', 'delete_channel'] },
  { label: 'Members', keys: ['invite', 'kick', 'ban_members', 'timeout_members'] },
  { label: 'Messages', keys: ['delete_others_messages', 'pin_messages'] },
  { label: 'Server', keys: ['edit_server', 'manage_emoji', 'manage_roles'] },
  { label: 'Images', keys: ['generate_images'] },
].map((g) => ({ label: g.label, actions: g.keys.map((k) => PERMISSION_ACTIONS.find((a) => a.key === k)) }));

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif'];
const VIDEO_EXT = ['mp4', 'webm', 'mov', 'm4v', 'ogv'];

// Per-user view state (what you were looking at) — survives a browser refresh.
export function loadViewState(userId) {
  try {
    return JSON.parse(localStorage.getItem(`disgourd.view.${userId || 'anon'}`)) || null;
  } catch {
    return null;
  }
}
// A channel name as the server stores it (server/validate.js): lowercase,
// spaces to dashes, only a-z 0-9 _ -, at most 60 characters.
export const MAX_CHANNEL_NAME = 60;
export function normalizeChannelName(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '');
}

// One server from GET /spaces with a channel renamed in place (P6-03), so the
// open channel can switch to the new name before the list is reloaded.
export function renameChannelIn(space, from, to) {
  const swap = (list) => (list || []).map((c) => (c === from ? to : c));
  const channelMeta = {};
  for (const [name, meta] of Object.entries(space.channelMeta || {})) channelMeta[name === from ? to : name] = meta;
  return { ...space, channels: swap(space.channels), voiceChannels: swap(space.voiceChannels), channelMeta };
}

export function saveViewState(userId, state) {
  try {
    localStorage.setItem(`disgourd.view.${userId || 'anon'}`, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

// Per-user custom ordering of the server rail (an array of server names).
export function loadServerOrder(userId) {
  try {
    return JSON.parse(localStorage.getItem(`disgourd.serverOrder.${userId || 'anon'}`)) || [];
  } catch {
    return [];
  }
}
export function saveServerOrder(userId, names) {
  try {
    localStorage.setItem(`disgourd.serverOrder.${userId || 'anon'}`, JSON.stringify(names));
  } catch {
    /* ignore */
  }
}
// Sort spaces by the saved order; servers not in the order keep their relative
// position at the end (newly created/joined ones).
export function applyServerOrder(list, order) {
  if (!order || !order.length) return list;
  const rank = new Map(order.map((n, i) => [n, i]));
  const at = (n) => (rank.has(n) ? rank.get(n) : Infinity);
  return [...list].sort((a, b) => {
    const ra = at(a.name);
    const rb = at(b.name);
    return ra === rb ? 0 : ra - rb;
  });
}

export function attachmentInfo(url) {
  if (!url) return null;
  let name = url;
  try {
    name = decodeURIComponent(url.split('/').pop() || url);
  } catch {
    name = url.split('/').pop() || url;
  }
  const ext = (name.split('.').pop() || '').toLowerCase();
  const isImage = IMAGE_EXT.includes(ext);
  const isVideo = VIDEO_EXT.includes(ext);
  return { url, name, ext, isImage, isVideo, isMedia: isImage || isVideo };
}

export function formatTime(ts) {
  const d = new Date(Number(ts));
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatDay(ts) {
  const d = new Date(Number(ts));
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, today)) return 'Today';
  if (sameDay(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
}

// "just now", "5 min ago", "3 h ago", "2 d ago", then the day.
export function formatAgo(ts, now = Date.now()) {
  const s = Math.max(0, Math.round((now - Number(ts)) / 1000));
  if (Number.isNaN(s)) return '';
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} d ago`;
  return formatDay(ts);
}

export function initials(name) {
  if (!name) return '?';
  const parts = String(name).trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Contrast of white text on hsl(hue 45% l%) (WCAG ratio).
function whiteOnHsl(hue, l) {
  const s = 0.45;
  const L = l / 100;
  const a = s * Math.min(L, 1 - L);
  const k = (n) => (n + hue / 30) % 12;
  const ch = (n) => {
    const v = L - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * ch(0) + 0.7152 * ch(8) + 0.0722 * ch(4);
  return 1.05 / (lum + 0.05);
}

// The avatar / server-icon colour for a hue: 45% saturation and 45%
// lightness, darkened only as far as needed for white initials to reach
// WCAG AA (4.5:1). Yellows and greens are bright at the same lightness, so
// they end up darker; blues and violets keep 45%.
export function avatarColor(hue) {
  let l = 45;
  while (l > 20 && whiteOnHsl(hue, l) < 4.5) l -= 1;
  return `hsl(${hue} 45% ${l}%)`;
}

// Deterministic pleasant color from a name, for avatars.
export function colorForName(name) {
  let hash = 0;
  const s = String(name || '');
  for (let i = 0; i < s.length; i += 1) hash = s.charCodeAt(i) + ((hash << 5) - hash);
  return avatarColor(Math.abs(hash) % 360);
}

// Merge message lists by id, keeping ascending order and dropping duplicates.
export function mergeMessages(existing, incoming) {
  const byId = new Map();
  for (const m of existing) if (m && m.id != null) byId.set(m.id, m);
  for (const m of incoming) if (m && m.id != null) byId.set(m.id, m);
  return Array.from(byId.values()).sort((a, b) => a.id - b.id);
}

export function humanSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

// Copy text to the clipboard, degrading gracefully off a secure context. The
// async Clipboard API needs HTTPS or localhost, so over a plain-HTTP LAN (e.g.
// a phone hitting the PC's IP) we fall back to the legacy execCommand path,
// which still works from a user gesture — including on iOS. Returns true on
// success so the caller can offer a manual "select & copy" if it fails.
export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    // Keep it in the viewport (offscreen/hidden textareas break copy on iOS).
    ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0;';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

// Words for an unread/mention badge, for screen readers: "5 unread, 2 mentions".
export function unreadLabel({ unread = 0, mentions = 0 }) {
  const parts = [];
  if (unread > 0) parts.push(`${unread} unread`);
  if (mentions > 0) parts.push(`${mentions} mention${mentions === 1 ? '' : 's'}`);
  return parts.join(', ');
}
