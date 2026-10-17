import { useEffect, useRef, useState } from 'react';
import Avatar from './Avatar.jsx';
import IconButton from './IconButton.jsx';

// Connection trouble wins over your chosen status in the footer.
const CONNECTION = {
  idle: { text: 'Not connected', color: 'bg-gray-500' },
  connecting: { text: 'Connecting…', color: 'bg-idle animate-pulse' },
  reconnecting: { text: 'Reconnecting…', color: 'bg-idle animate-pulse' },
  closed: { text: 'Disconnected', color: 'bg-danger' },
};

// The statuses you can pick. `dot` is how others see you (invisible = offline).
export const PRESENCE_MODES = [
  { id: 'online', label: 'Online', dot: 'online' },
  { id: 'idle', label: 'Idle', dot: 'idle' },
  { id: 'dnd', label: 'Do Not Disturb', dot: 'dnd', hint: 'Mutes notifications and sounds' },
  { id: 'invisible', label: 'Invisible', dot: 'offline', hint: 'You’ll appear offline' },
];
const DOT_CLASS = { online: 'bg-online', idle: 'bg-idle', dnd: 'bg-pink', offline: 'bg-gray-500' };

// The current-user strip at the bottom of the left sidebar: your avatar (click
// it to set your status), your name and status (click for your profile), and
// sign-out.
export default function UserFooter({ user, avatar, status, presence = 'online', onSetPresence, onOpenProfile, onLogout }) {
  const mode = PRESENCE_MODES.find((m) => m.id === presence) || PRESENCE_MODES[0];
  const trouble = status !== 'open' ? CONNECTION[status] || CONNECTION.idle : null;
  const [menuOpen, setMenuOpen] = useState(false);
  const openerRef = useRef(null);
  const menuRef = useRef(null);

  // Focus the chosen status when the menu opens.
  useEffect(() => {
    if (!menuOpen) return undefined;
    menuRef.current?.querySelector('[aria-checked="true"]')?.focus();
    const away = (e) => {
      if (!menuRef.current?.contains(e.target) && !openerRef.current?.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [menuOpen]);

  function close() {
    setMenuOpen(false);
    openerRef.current?.focus();
  }

  function onMenuKey(e) {
    const items = [...(menuRef.current?.querySelectorAll('[role="menuitemradio"]') || [])];
    const i = items.indexOf(document.activeElement);
    const to = { ArrowDown: (i + 1) % items.length, ArrowUp: (i - 1 + items.length) % items.length, Home: 0, End: items.length - 1 }[e.key];
    if (to !== undefined) {
      e.preventDefault();
      items[to]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') {
      setMenuOpen(false);
    }
  }

  return (
    <div className="relative flex items-center gap-1 bg-ink-900/60 px-2 py-2">
      <button
        ref={openerRef}
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        aria-label={`Set status (${mode.label})`}
        title="Set status"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className="shrink-0 rounded-full p-0.5 transition hover:bg-ink-600/50"
      >
        <Avatar name={user} size={32} src={avatar} status={mode.dot} />
      </button>
      <button
        onClick={onOpenProfile}
        title="Edit your profile"
        className="flex min-w-0 flex-1 flex-col rounded-sm px-1 py-0.5 text-left transition hover:bg-ink-600/50"
      >
        <span className="truncate text-sm font-semibold">{user}</span>
        <span className="flex items-center gap-1.5 text-xs text-gray-400">
          <span className={`h-2 w-2 rounded-full ${trouble ? trouble.color : DOT_CLASS[mode.dot]}`} />
          {trouble ? trouble.text : mode.label}
        </span>
      </button>
      <IconButton
        icon="logout"
        size={17}
        label="Sign out"
        onClick={onLogout}
        className="rounded-lg p-1.5 text-gray-400 transition hover:bg-ink-600 hover:text-fg"
      />
      {menuOpen && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Set status"
          onKeyDown={onMenuKey}
          className="anim-pop absolute bottom-full left-2 z-40 mb-2 w-60 rounded-lg bg-ink-900 p-1 shadow-xl ring-1 ring-ink-500/60"
        >
          {PRESENCE_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="menuitemradio"
              aria-checked={m.id === mode.id}
              tabIndex={m.id === mode.id ? 0 : -1}
              onClick={() => {
                onSetPresence?.(m.id);
                close();
              }}
              className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm transition hover:bg-ink-600 focus-visible:bg-ink-600 ${
                m.id === mode.id ? 'text-fg' : 'text-gray-300'
              }`}
            >
              <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${DOT_CLASS[m.dot]}`} aria-hidden="true" />
              <span className="min-w-0">
                {m.label}
                {m.hint && <span className="block text-xs text-gray-500">{m.hint}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
