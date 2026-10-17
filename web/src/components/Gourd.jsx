// The DisGourd logo: a bottle gourd whose lower bulb is an open speech bubble,
// with a leaf on the stem. Paths match design/brand/disgourd-mark*.svg.
//
// With no `color` it draws the full-colour mark from the theme tokens (violet
// body, lime leaf), so the light theme's darker lime keeps the leaf readable. Pass `color` to draw it in one colour (e.g. white on a
// brand tile, or a faint watermark). Below ~28px it switches to the small-size
// drawing: thicker bubble walls and no stem, so it stays readable.
const BODY_OUTER =
  'M44.5 24.5 Q44.5 21 48 21 H52 Q55.5 21 55.5 24.5 V26 ' +
  'C55.5 29.5 63.5 31 63.5 39.5 C63.5 45.5 59 47.5 59 51 ' +
  'C59 54 74 57.5 74 71.5 C74 84 63.5 92 50 92 ' +
  'C45.6 92 41.5 91.2 38 89.6 L23.5 97.5 L29.6 84.6 ' +
  'C27.3 80.9 26 76.4 26 71.5 C26 57.5 41 54 41 51 ' +
  'C41 47.5 36.5 45.5 36.5 39.5 C36.5 31 44.5 29.5 44.5 26 Z';
const BODY_INNER =
  'M37.4 80.4 C35.2 77.9 34 74.9 34 71.6 C34 64.6 41.2 59.6 50 59.6 ' +
  'C58.8 59.6 66 64.6 66 71.6 C66 78.6 58.8 83.8 50 83.8 ' +
  'C46.3 83.8 42.9 83 40.2 81.5 L33.6 85.6 Z';
const BODY_INNER_SMALL =
  'M38.6 79.6 C36.9 77.4 36 74.8 36 72 C36 66 42.3 61.8 50 61.8 ' +
  'C57.7 61.8 64 66 64 72 C64 78 57.7 82.2 50 82.2 ' +
  'C46.8 82.2 43.9 81.5 41.6 80.3 L36.8 83.3 Z';
const STEM = 'M49.2 21 C48.8 17.2 46.8 14.3 43.6 12.6';
const LEAF = 'M51.6 20.2 C52.4 13.4 57.6 9.2 67.8 9.4 C67.6 16 62.2 20.6 51.6 20.2 Z';
const LEAF_VEIN = 'M54.4 18.6 L64.2 12.4 L55.4 19.4 Z';

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
