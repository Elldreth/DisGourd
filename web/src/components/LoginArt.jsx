import { BODY_OUTER, BODY_INNER, STEM, LEAF, LEAF_VEIN } from '../mascotParts.js';

// The sign-in screens' backdrop (P8): a vine with speech-bubble gourds hanging
// from it, flat, in the theme's colours. Wide screens get a garland across the
// top; phones get a low vine along the bottom with gourds standing on it. Both
// keep clear of the card in the middle. Decorative only.

const violet = 'var(--color-brand-logo)';
const lime = 'var(--color-lime)';

// One gourd mark, hung from (x, y) by a short string, at `size` px.
function HangingGourd({ x, y, size, drop, tilt = 0 }) {
  const s = size / 100;
  return (
    <g transform={`translate(${x} ${y}) rotate(${tilt})`}>
      <line x1="0" y1="0" x2="0" y2={drop} stroke={violet} strokeWidth="3" strokeLinecap="round" />
      <g transform={`translate(${-50 * s} ${drop - 12 * s}) scale(${s})`}>
        <path fill={violet} fillRule="evenodd" d={`${BODY_OUTER} ${BODY_INNER}`} />
        <path fill="none" stroke={lime} strokeWidth="2.8" strokeLinecap="round" d={STEM} />
        <path fill={lime} fillRule="evenodd" d={`${LEAF} ${LEAF_VEIN}`} />
      </g>
    </g>
  );
}

// A leaf on the vine at (x, y), turned by `angle` degrees.
const Leaf = ({ x, y, angle, size = 1.3 }) => (
  <path d={LEAF} fill={lime} transform={`translate(${x} ${y}) rotate(${angle}) scale(${size}) translate(-52 -20)`} />
);

// Wide: a garland. The vine is a gentle wave; gourds hang from its low points.
const waveY = (x) => 110 + 40 * Math.sin((x / 520) * 2 * Math.PI - 0.6);
function Garland() {
  const pts = [];
  for (let x = -60; x <= 1660; x += 20) pts.push(`${x},${waveY(x).toFixed(1)}`);
  const gourds = [
    // Kept to the outer thirds, so they stay clear of the card from 768px up.
    { x: 110, size: 92, drop: 64, tilt: 3 },
    { x: 360, size: 112, drop: 84, tilt: -2 },
    { x: 1240, size: 104, drop: 76, tilt: 2 },
    { x: 1490, size: 86, drop: 58, tilt: -3 },
  ];
  const leaves = [60, 300, 360, 620, 700, 900, 980, 1260, 1330, 1560];
  return (
    <svg className="absolute inset-x-0 top-0 hidden h-auto w-full md:block" viewBox="0 0 1600 420" preserveAspectRatio="xMidYMin slice" aria-hidden="true" data-art="login-wide">
      <polyline points={pts.join(' ')} fill="none" stroke={violet} strokeWidth="5" strokeLinecap="round" opacity="0.9" />
      {leaves.map((x, i) => (
        <Leaf key={x} x={x} y={waveY(x)} angle={i % 2 ? 35 : -150} />
      ))}
      {gourds.map((g) => (
        <HangingGourd key={g.x} x={g.x} y={waveY(g.x)} size={g.size} drop={g.drop} tilt={g.tilt} />
      ))}
    </svg>
  );
}

// Phones: a low vine along the bottom with gourds standing on it, in the
// space below the card.
const groundY = (x) => 118 + 10 * Math.sin((x / 190) * 2 * Math.PI);
function GroundVine() {
  const pts = [];
  for (let x = -20; x <= 400; x += 10) pts.push(`${x},${groundY(x).toFixed(1)}`);
  const gourds = [
    { x: 58, size: 70, tilt: -6 },
    { x: 196, size: 92, tilt: 2 },
    { x: 322, size: 62, tilt: 7 },
  ];
  return (
    <svg className="absolute inset-x-0 bottom-0 h-auto w-full md:hidden" viewBox="0 0 375 150" preserveAspectRatio="xMidYMax meet" aria-hidden="true" data-art="login-tall">
      <polyline points={pts.join(' ')} fill="none" stroke={violet} strokeWidth="4" strokeLinecap="round" opacity="0.9" />
      {[20, 128, 262, 360].map((x, i) => (
        <Leaf key={x} x={x} y={groundY(x)} angle={i % 2 ? -40 : -140} size={0.9} />
      ))}
      {gourds.map((g) => {
        const s = g.size / 100;
        return (
          <g key={g.x} transform={`translate(${g.x} ${groundY(g.x)}) rotate(${g.tilt}) translate(${-50 * s} ${-95 * s}) scale(${s})`}>
            <path fill={violet} fillRule="evenodd" d={`${BODY_OUTER} ${BODY_INNER}`} />
            <path fill="none" stroke={lime} strokeWidth="2.8" strokeLinecap="round" d={STEM} />
            <path fill={lime} fillRule="evenodd" d={`${LEAF} ${LEAF_VEIN}`} />
          </g>
        );
      })}
    </svg>
  );
}

export default function LoginArt() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-70">
      <Garland />
      <GroundVine />
    </div>
  );
}
