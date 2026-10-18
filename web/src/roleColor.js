// Role colours (P2-21d): a member's name takes the colour of their highest
// role that has one, nudged just enough to stay readable (WCAG AA, 4.5:1) on
// every surface a name sits on, separately for each theme.

// The surfaces names sit on, per theme: ink-600 … ink-900 and the "mentions
// you" tint (pink at 10% over ink-700). Kept in step with index.css by
// roleColor.test.js.
export const SURFACES = {
  dark: ['#252047', '#1d1838', '#151129', '#0e0b1a', mix('#1d1838', '#ff5fa2', 0.1)],
  light: ['#e8e2f6', '#fcfbff', '#f3f0fb', '#eae5f7', mix('#fcfbff', '#9a1052', 0.1)],
};
const MIN_RATIO = 4.5;

function rgb(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}
function hex(c) {
  return `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}
// `b` at `t` over `a`.
function mix(a, b, t) {
  const [x, y] = [rgb(a), rgb(b)];
  return hex(x.map((v, i) => v + (y[i] - v) * t));
}
function luminance(h) {
  const c = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = rgb(h);
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
}
export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
const readsOn = (color, theme) => SURFACES[theme].every((s) => contrast(color, s) >= MIN_RATIO);

// `color` (#rrggbb) made readable in `theme`: unchanged if it already is,
// otherwise mixed towards white (dark theme) or black (light theme) in small
// steps until it is.
export function readableColor(color, theme) {
  if (!/^#[0-9a-f]{6}$/i.test(color || '')) return null;
  const c = color.toLowerCase();
  const toward = theme === 'light' ? '#000000' : '#ffffff';
  for (let t = 0; t <= 1.0001; t += 0.05) {
    const next = mix(c, toward, Math.min(t, 1));
    if (readsOn(next, theme)) return next;
  }
  return toward;
}

// The colour for a member: their highest role (roles come highest first)
// that has a colour, or null.
export function memberColor(memberRoleIds, roles) {
  const mine = new Set(memberRoleIds || []);
  return roles.find((r) => !r.isDefault && r.color && mine.has(r.id))?.color || null;
}

// username -> { dark, light } for everyone in `members` with a coloured role.
export function nameColors(members, roles) {
  const out = new Map();
  for (const m of members) {
    const color = memberColor(m.roles, roles);
    if (color) out.set(m.username, { dark: readableColor(color, 'dark'), light: readableColor(color, 'light') });
  }
  return out;
}
