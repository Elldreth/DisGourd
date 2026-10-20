// The DisGourd logo: a bottle gourd whose lower bulb is an open speech bubble,
// with a leaf on the stem. Paths match design/brand/disgourd-mark*.svg.
//
// With no `color` it draws the full-colour mark from the theme tokens (violet
// body, lime leaf), so the light theme's darker lime keeps the leaf readable. Pass `color` to draw it in one colour (e.g. white on a
// brand tile, or a faint watermark). Below ~28px it switches to the small-size
// drawing: thicker bubble walls and no stem, so it stays readable.
import { BODY_OUTER, BODY_INNER, BODY_INNER_SMALL, STEM, LEAF, LEAF_VEIN } from '../mascotParts.js';

export const GOURD_VIOLET = '#9466FF';
export const GOURD_LIME = '#B8F34A';

export default function Gourd({ size = 24, color, className = '', title }) {
  const small = size < 28;
  const body = color || 'var(--color-brand-logo)';
  const leaf = color || 'var(--color-lime)';
  return (
    <svg
      width={size}
      height={size}
      viewBox="-4 4 100 100"
      className={className}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : 'true'}
      aria-label={title}
    >
      {title ? <title>{title}</title> : null}
      <path fill={body} fillRule="evenodd" d={`${BODY_OUTER} ${small ? BODY_INNER_SMALL : BODY_INNER}`} />
      {!small && <path fill="none" stroke={leaf} strokeWidth="2.8" strokeLinecap="round" d={STEM} />}
      <path fill={leaf} fillRule="evenodd" d={small ? LEAF : `${LEAF} ${LEAF_VEIN}`} />
    </svg>
  );
}
