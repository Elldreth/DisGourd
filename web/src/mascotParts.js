// The gourd mark's shapes and the mascot's poses (P8 art pass), as plain data
// so the React components and the static offline page draw the same thing.
// Coordinates are in the mark's own space (viewBox "-4 4 100 100").
//
// The mascot has no face: its speech-bubble belly "says" the mood with a lime
// symbol inside it, plus a small prop. Each part is [tag, attrs], with fill or
// stroke given as 'V' (violet body) or 'L' (lime leaf); a group is
// ['g', attrs, [...parts]].

export const BODY_OUTER =
  'M44.5 24.5 Q44.5 21 48 21 H52 Q55.5 21 55.5 24.5 V26 ' +
  'C55.5 29.5 63.5 31 63.5 39.5 C63.5 45.5 59 47.5 59 51 ' +
  'C59 54 74 57.5 74 71.5 C74 84 63.5 92 50 92 ' +
  'C45.6 92 41.5 91.2 38 89.6 L23.5 97.5 L29.6 84.6 ' +
  'C27.3 80.9 26 76.4 26 71.5 C26 57.5 41 54 41 51 ' +
  'C41 47.5 36.5 45.5 36.5 39.5 C36.5 31 44.5 29.5 44.5 26 Z';
export const BODY_INNER =
  'M37.4 80.4 C35.2 77.9 34 74.9 34 71.6 C34 64.6 41.2 59.6 50 59.6 ' +
  'C58.8 59.6 66 64.6 66 71.6 C66 78.6 58.8 83.8 50 83.8 ' +
  'C46.3 83.8 42.9 83 40.2 81.5 L33.6 85.6 Z';
export const BODY_INNER_SMALL =
  'M38.6 79.6 C36.9 77.4 36 74.8 36 72 C36 66 42.3 61.8 50 61.8 ' +
  'C57.7 61.8 64 66 64 72 C64 78 57.7 82.2 50 82.2 ' +
  'C46.8 82.2 43.9 81.5 41.6 80.3 L36.8 83.3 Z';
export const STEM = 'M49.2 21 C48.8 17.2 46.8 14.3 43.6 12.6';
export const LEAF = 'M51.6 20.2 C52.4 13.4 57.6 9.2 67.8 9.4 C67.6 16 62.2 20.6 51.6 20.2 Z';
export const LEAF_VEIN = 'M54.4 18.6 L64.2 12.4 L55.4 19.4 Z';

const line = (d, color = 'L', width = 2.6) => ['path', { d, fill: 'none', stroke: color, strokeWidth: width, strokeLinecap: 'round', strokeLinejoin: 'round' }];
const dot = (cx, cy, r, color = 'L') => ['circle', { cx, cy, r, fill: color }];

// A five-point star centred on (cx, cy).
function star(cx, cy, outer, inner) {
  const pts = [];
  for (let i = 0; i < 10; i += 1) {
    const r = i % 2 ? inner : outer;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return ['polygon', { points: pts.join(' '), fill: 'L' }];
}

const body = [
  ['path', { d: `${BODY_OUTER} ${BODY_INNER}`, fill: 'V', fillRule: 'evenodd' }],
  line(STEM, 'L', 2.8),
];
const leaf = [['path', { d: `${LEAF} ${LEAF_VEIN}`, fill: 'L', fillRule: 'evenodd' }]];

// Each pose: what's drawn behind the body, the body (with or without its
// leaf), and what's drawn on top. `tilt` leans the whole gourd.
export const POSES = {
  // Hello: the leaf waves (tipped up, with motion marks), a wave in the bubble.
  wave: {
    label: 'waving',
    noLeaf: true,
    front: [
      ['g', { transform: 'rotate(-28 51.6 20.2)' }, leaf],
      line('M71 2 q4.5 4.5 0.5 10', 'L', 2.2),
      line('M77 -1.5 q6.5 7 0.5 16', 'L', 2.2),
      line('M42 72 q2 -4 4 0 t4 0 t4 0 t4 0'),
    ],
  },
  // Asleep: a z in the bubble and more drifting up.
  sleep: {
    label: 'sleeping',
    front: [line('M45.5 66 h9 l-9 11 h9'), line('M73 36 h6 l-6 7 h6', 'L', 2.2), line('M83 22 h8 l-8 9 h8', 'L', 2.4)],
  },
  // Listening: headphones on, a note in the bubble.
  music: {
    label: 'with headphones',
    back: [line('M32.5 46 C32.5 8 67.5 8 67.5 46', 'V', 4.5)],
    front: [
      ['rect', { x: 28.5, y: 38, width: 8, height: 14, rx: 3, fill: 'L' }],
      ['rect', { x: 63.5, y: 38, width: 8, height: 14, rx: 3, fill: 'L' }],
      dot(46.5, 76.5, 3.6),
      line('M50 76.5 V64.5 q5 1 6.5 5.5', 'L', 2.4),
    ],
  },
  // Looking for something: a magnifier at its side.
  search: {
    label: 'with a magnifier',
    front: [
      ['circle', { cx: 81, cy: 57, r: 11, fill: 'none', stroke: 'V', strokeWidth: 5 }],
      line('M89 65 L98.5 76', 'V', 6),
      line('M74 53 a8 8 0 0 1 6 -5', 'L', 3),
      // A small lens in the bubble: "looking".
      ['circle', { cx: 49, cy: 70.5, r: 4.2, fill: 'none', stroke: 'L', strokeWidth: 2.4 }],
      line('M52 73.5 L55.5 77', 'L', 2.4),
    ],
  },
  // Puzzled: a question mark in the bubble and a small one above.
  confused: {
    label: 'confused',
    front: [
      line('M45.5 67.3 q0 -5.2 4.8 -5.2 q4.8 0 4.8 4.3 q0 3 -4.2 4.4 v2.3', 'L', 3),
      dot(50.9, 78.6, 1.9),
      line('M71 25 q0 -3.4 3.2 -3.4 q3.2 0 3.2 2.8 q0 2 -2.8 2.9 v1.5', 'L', 2.2),
      dot(74.6, 33, 1.3),
    ],
  },
  // Celebrating: a party hat instead of the leaf, confetti, a star.
  party: {
    label: 'celebrating',
    noLeaf: true,
    front: [
      ['path', { d: 'M43 23.5 L57.5 21.5 L51.5 2.5 Z', fill: 'L' }],
      line('M46.4 14 L54.6 12.8', 'V', 2),
      dot(51.5, 2.5, 3.2, 'V'),
      dot(20, 27, 2.2),
      dot(81, 18, 2.2, 'V'),
      dot(86, 42, 1.7),
      dot(15, 48, 1.7, 'V'),
      ['rect', { x: 72, y: 29, width: 5, height: 2.4, rx: 1, fill: 'L', transform: 'rotate(-30 74.5 30.2)' }],
      ['rect', { x: 23, y: 36, width: 5, height: 2.4, rx: 1, fill: 'V', transform: 'rotate(25 25.5 37.2)' }],
      star(50, 72.2, 7.5, 3.2),
    ],
  },
  // Quiet please: three dots, and sound waves struck through.
  shush: {
    label: 'shushing',
    front: [
      dot(42.5, 72, 2.4),
      dot(50, 72, 2.4),
      dot(57.5, 72, 2.4),
      line('M76 50 q5 -6 0 -12', 'L', 2.4),
      line('M83 54 q9 -10 0 -20', 'L', 2.4),
      line('M73 58 L89 30', 'V', 3),
    ],
  },
};

export const POSE_NAMES = Object.keys(POSES);

// The parts of one pose, in drawing order.
export function poseParts(name) {
  const p = POSES[name] || POSES.wave;
  const figure = [...(p.back || []), ...body, ...(p.noLeaf ? [] : leaf), ...(p.front || [])];
  return p.tilt ? [['g', { transform: `rotate(${p.tilt} 50 92)` }, figure]] : figure;
}

// The viewBox with room for the props around the mark.
export const MASCOT_VIEWBOX = '-12 -4 120 108';

// A pose as an SVG string (for static pages like offline.html).
export function mascotSvg(name, { violet = '#9466FF', lime = '#B8F34A', size = 96, title } = {}) {
  const color = (v) => (v === 'V' ? violet : v === 'L' ? lime : v);
  const attr = (k) => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
  const draw = ([tag, attrs, kids]) => {
    const a = Object.entries(attrs)
      .map(([k, v]) => `${attr(k)}="${k === 'fill' || k === 'stroke' ? color(v) : v}"`)
      .join(' ');
    return kids ? `<${tag} ${a}>${kids.map(draw).join('')}</${tag}>` : `<${tag} ${a}/>`;
  };
  const label = title ? ` role="img" aria-label="${title}"` : ' aria-hidden="true"';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${MASCOT_VIEWBOX}"${label}>${poseParts(name).map(draw).join('')}</svg>`;
}
