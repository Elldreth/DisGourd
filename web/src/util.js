// Small presentation helpers shared across components.

// Role hierarchy: member < admin < owner. Permissions are "minimum rank to act".
export const ROLE_RANK = { member: 1, admin: 2, owner: 3 };
export const roleRank = (role) => ROLE_RANK[role] || 0;
// Server actions the owner can gate, with friendly labels (order = display order).
export const PERMISSION_ACTIONS = [
  { key: 'create_channel', label: 'Create channels' },
  { key: 'delete_channel', label: 'Delete channels' },
  { key: 'invite', label: 'Invite people' },
  { key: 'kick', label: 'Remove members' },
  { key: 'delete_others_messages', label: "Delete others' messages" },
  { key: 'edit_server', label: 'Edit server (name, icon)' },
  { key: 'manage_roles', label: 'Manage roles' },
];

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

export function initials(name) {
  if (!name) return '?';
  const parts = String(name).trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Deterministic pleasant color from a name, for avatars.
export function colorForName(name) {
  let hash = 0;
  const s = String(name || '');
  for (let i = 0; i < s.length; i += 1) hash = s.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 45% 45%)`;
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
