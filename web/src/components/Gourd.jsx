// The DisGourd mascot: a bottle gourd, tilted stem-up-left and drawn as a single
// flat shape. Pass `color` to tint it (defaults to currentColor) and `size` for
// the pixel box. White on a brand-purple tile for app-icon spots; brand purple
// directly on dark for the big login / empty-state moments.
export default function Gourd({ size = 24, color = 'currentColor', className = '', title }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="-48 -48 96 96"
      className={className}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : 'true'}
      aria-label={title}
    >
      {title ? <title>{title}</title> : null}
      <g transform="rotate(-45)">
        <path
          d="M0 -33 C9 -33 15 -28 15 -21 C15 -14 13 -8 13 -3 C13 3 27 -2 27 15 C27 32 16 42 0 42 C-16 42 -27 32 -27 15 C-27 -2 -13 3 -13 -3 C-13 -8 -15 -14 -15 -21 C-15 -28 -9 -33 0 -33 Z"
          fill={color}
        />
        <path
          d="M0 -32 C-1 -40 3 -44 7 -43"
          stroke={color}
          strokeWidth="5"
          fill="none"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}
