import { useEffect, useRef } from 'react';
import Icon from './Icon.jsx';
import IconButton from './IconButton.jsx';

// A side column next to the chat (P7-03), laid out like the thread panel: full
// screen with a back button on phones, a 24rem column from lg up. The chat
// stays usable beside it, so Pins and Threads can stay open while you jump
// around. Esc inside it closes it; focus moves into it when it opens.
export default function SidePanel({ label, icon, title, subtitle, backLabel, actions, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  function onKeyDown(e) {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    e.preventDefault();
    e.stopPropagation();
    onClose();
  }
  return (
    <aside
      ref={ref}
      tabIndex={-1}
      role="complementary"
      aria-label={label}
      onKeyDown={onKeyDown}
      className="anim-fade fixed inset-0 z-40 flex min-h-0 flex-col bg-ink-700 outline-none lg:static lg:z-auto lg:w-96 lg:shrink-0 lg:border-l lg:border-ink-900/60"
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-ink-900/60 px-3 shadow-xs shadow-black/20">
        <IconButton
          icon="chevronLeft"
          size={20}
          label={backLabel}
          onClick={onClose}
          className="tap -ml-1 rounded-lg p-1.5 text-gray-300 transition hover:bg-ink-600 hover:text-fg lg:hidden"
        />
        <Icon name={icon} size={18} className="shrink-0 text-brand-hi" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-bold leading-tight">{title}</h2>
          {subtitle && <p className="truncate text-xs leading-tight text-gray-500">{subtitle}</p>}
        </div>
        {actions}
        <IconButton
          icon="x"
          size={18}
          label={`Close ${label.toLowerCase()}`}
          onClick={onClose}
          className="tap hidden rounded-lg p-1.5 text-gray-400 transition hover:bg-ink-600 hover:text-fg lg:inline-flex"
        />
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">{children}</div>
    </aside>
  );
}
