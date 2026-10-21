import { poseParts, groupParts, POSES, MASCOT_VIEWBOX, GROUP_VIEWBOX } from '../mascotParts.js';

// The pose's shapes alone, for drawing inside another SVG (an empty-state
// scene places it with a nested <svg x y width height viewBox={MASCOT_VIEWBOX}>).
export function MascotParts({ pose = 'wave' }) {
  return poseParts(pose).map(drawWith('var(--color-brand-logo)', 'var(--color-lime)'));
}

function drawWith(violet, lime) {
  const paint = (v) => (v === 'V' ? violet : v === 'L' ? lime : v);
  const draw = ([Tag, attrs, kids], i) => {
    const props = { ...attrs };
    if (attrs.fill) props.fill = paint(attrs.fill);
    if (attrs.stroke) props.stroke = paint(attrs.stroke);
    return kids ? (
      <Tag key={i} {...props}>
        {kids.map(draw)}
      </Tag>
    ) : (
      <Tag key={i} {...props} />
    );
  };
  return draw;
}

// The DisGourd mascot (P8): the gourd mark in a pose. It has no face; its
// speech-bubble belly "says" the mood. Drawn from the theme tokens, so it
// follows the light theme, or in one colour with `color`.
//   <Mascot pose="wave" size={80} />   poses: wave, sleep, music, search, confused, party, shush, clear, privacy
// Decorative by default; pass `title` when it carries meaning on its own.
export default function Mascot({ pose = 'wave', size = 64, color, title, className = '' }) {
  const draw = drawWith(color || 'var(--color-brand-logo)', color || 'var(--color-lime)');
  return (
    <svg
      width={size}
      height={size}
      viewBox={MASCOT_VIEWBOX}
      className={className}
      data-pose={POSES[pose] ? pose : 'wave'}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : 'true'}
      aria-label={title}
    >
      {title ? <title>{title}</title> : null}
      {poseParts(pose).map(draw)}
    </svg>
  );
}

// Three gourds together (P10-08), for group conversations. Decorative.
export function MascotGroup({ width = 144, className = '' }) {
  const draw = drawWith('var(--color-brand-logo)', 'var(--color-lime)');
  return (
    <svg width={width} height={(width * 96) / 156} viewBox={GROUP_VIEWBOX} className={className} data-art="group" aria-hidden="true">
      {groupParts().map(draw)}
    </svg>
  );
}
