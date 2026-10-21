import Icon from './Icon.jsx';

// The ☰ button that opens the navigation drawer on phones (P10-07). On a
// phone the server rail lives in the drawer, so its badges are out of sight:
// a dot here says something is waiting — red for unread DMs or mentions,
// amber for open reports (red wins) — and the label says so too.
export default function NavButton({ label, alert = null, size = 20, onClick, className = '' }) {
  const note = alert === 'red' ? ' (unread)' : alert === 'amber' ? ' (open reports)' : '';
  return (
    <button type="button" aria-label={`${label}${note}`} title={label} onClick={onClick} className={`${className.includes('absolute') ? '' : 'relative '}${className}`}>
      <Icon name="menu" size={size} />
      {alert && (
        <span
          data-nav-alert={alert}
          aria-hidden="true"
          className={`absolute right-0.5 top-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-ink-700 ${alert === 'red' ? 'bg-danger' : 'bg-idle'}`}
        />
      )}
    </button>
  );
}

// What the dot shows: red when DMs are unread or you're mentioned somewhere,
// amber when a server you moderate has open reports, else nothing.
export function navAlert({ dmUnread = 0, mentions = 0, openReports = 0 } = {}) {
  if (dmUnread > 0 || mentions > 0) return 'red';
  if (openReports > 0) return 'amber';
  return null;
}
