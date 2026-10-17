import Gourd from './Gourd.jsx';
import Icon from './Icon.jsx';

// One look for every empty state (P4-03): a flat spot illustration (or, in
// small panels, an icon), a heading, one line and an optional action. The
// four illustrations are drawn with the gourd mark and the theme's colours,
// so they follow the light theme and read in one colour.
//
//   <EmptyState art="channel" title="Welcome to #general" body="Say hello!" />
//   <EmptyState icon="pin" compact title="No pinned messages yet" body="Pin one from its menu." />

const violet = 'var(--color-brand-logo)';
const lime = 'var(--color-lime)';
// A gourd mark placed in art space: the mark's own box is 100 wide.
const Mark = ({ x, y, size, flip }) => (
  <g transform={`translate(${x} ${y})${flip ? ` translate(${size} 0) scale(-1 1)` : ''}`}>
    <Gourd size={size} />
  </g>
);
// A faint ground line so the figures stand on something.
const Ground = ({ x = 40, w = 120, y = 118 }) => <rect x={x} y={y} width={w} height="3" rx="1.5" fill={violet} opacity="0.25" />;

export const ART = {
  // An empty channel: one gourd, alone, with room around it.
  channel: (
    <>
      <Ground />
      <Mark x={55} y={14} size={90} />
    </>
  ),
  // No DMs: two gourds turned to each other, about to talk.
  dms: (
    <>
      <Ground x={20} w={160} />
      <Mark x={28} y={26} size={78} />
      <Mark x={94} y={26} size={78} flip />
      <circle cx="100" cy="52" r="3" fill={lime} />
      <circle cx="100" cy="64" r="3" fill={lime} opacity="0.6" />
      <circle cx="100" cy="76" r="3" fill={lime} opacity="0.3" />
    </>
  ),
  // No server: a gourd just planted in a pot.
  server: (
    <>
      <Ground x={50} w={100} y={124} />
      <path d="M72 92 H128 L121 122 H79 Z" fill={violet} opacity="0.55" />
      <rect x="66" y="86" width="68" height="9" rx="3" fill={violet} />
      <Mark x={62} y={6} size={76} />
    </>
  ),
  // Nothing found: a gourd with a magnifier leaning on it.
  search: (
    <>
      <Ground x={30} w={110} />
      <Mark x={36} y={14} size={90} />
      <circle cx="140" cy="62" r="24" fill="none" stroke={violet} strokeWidth="7" />
      <path d="M151 85 L170 110" stroke={violet} strokeWidth="9" strokeLinecap="round" />
      <path d="M128 54 a12 12 0 0 1 10 -8" fill="none" stroke={lime} strokeWidth="4" strokeLinecap="round" />
    </>
  ),
};

export default function EmptyState({ art, icon, title, body, action, as, compact = false, className = '' }) {
  const Heading = as || (compact ? 'p' : 'h3');
  const headingClass = compact ? 'text-sm font-semibold text-gray-300' : 'text-lg font-semibold text-gray-200';
  return (
    <div className={`flex flex-col items-center px-4 text-center ${compact ? 'py-6' : 'py-10'} ${className}`}>
      {art && ART[art] ? (
        <svg
          viewBox="0 0 200 130"
          width={compact ? 120 : 180}
          height={compact ? 78 : 117}
          aria-hidden="true"
          data-art={art}
          className="mb-4 max-w-full"
        >
          {ART[art]}
        </svg>
      ) : icon ? (
        <Icon name={icon} size={compact ? 28 : 44} className="mb-3 text-gray-600" />
      ) : null}
      <Heading className={headingClass}>{title}</Heading>
      {body && <p className="mt-1 max-w-xs text-sm text-gray-500">{body}</p>}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="tap-row mt-4 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-hover"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
