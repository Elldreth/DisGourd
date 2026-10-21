import { useEffect, useState } from 'react';
import { initials, colorForName, unreadLabel } from '../util.js';
import Icon from './Icon.jsx';
import Gourd from './Gourd.jsx';
import CreateServerDialog from './CreateServerDialog.jsx';

// The far-left rail of server (space) icons, Discord-style, plus create/join.
// (An invite link joins and opens its server directly since P14-02.)
export default function ServerRail({
  spaces,
  currentSpace,
  unread = {},
  mentions = {},
  dmActive,
  dmUnread = 0,
  onSelectDms,
  onSelect,
  onCreate,
  onJoin,
  onReorder,
  openRequest = null, // { tab, n }: open the Add-a-server dialog on that tab (P3-20b)
}) {
  const [dialog, setDialog] = useState(null); // { tab: 'create' | 'join', code } | null
  const [dragIndex, setDragIndex] = useState(null);
  const [dropIndex, setDropIndex] = useState(null);

  useEffect(() => {
    if (openRequest) setDialog({ tab: openRequest.tab, code: '' });
    // A new request (n) opens it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest?.n]);

  function handleDrop(toIndex) {
    if (dragIndex !== null && dragIndex !== toIndex && onReorder) {
      const names = spaces.map((s) => s.name);
      const [moved] = names.splice(dragIndex, 1);
      names.splice(toIndex, 0, moved);
      onReorder(names);
    }
    setDragIndex(null);
    setDropIndex(null);
  }

  return (
    <nav aria-label="Servers" className="relative flex w-[72px] flex-col items-center gap-2 bg-ink-900 py-3">
      <h1 className="sr-only">DisGourd</h1>
      <button
        onClick={onSelectDms}
        title="Direct Messages"
        aria-label={['Direct Messages', dmActive ? '' : unreadLabel({ unread: dmUnread })].filter(Boolean).join(', ')}
        className={`relative mb-1 flex h-12 w-12 items-center justify-center transition-all hover:rounded-2xl active:scale-90 ${
          dmActive ? 'rounded-2xl bg-brand text-white' : 'rounded-[26px] bg-ink-700 text-fg hover:bg-brand hover:text-white'
        }`}
      >
        <Gourd size={34} color="currentColor" title="Direct Messages" />
        {dmUnread > 0 && !dmActive && (
          <span aria-hidden="true" className="absolute -bottom-1 -right-1 flex h-5 min-w-[20px] items-center justify-center rounded-full border-2 border-ink-900 bg-danger px-1 pt-px text-xs font-bold leading-none text-ink-900">
            {dmUnread > 99 ? '99+' : dmUnread}
          </span>
        )}
      </button>
      <div role="separator" aria-orientation="horizontal" className="h-px w-8 bg-ink-500/50" />

      {/* The full rail width (and a little room above and below), so badges on
          top of an icon's corner aren't clipped by this scrolling list (P9-01). */}
      <div className="-my-1.5 flex w-full flex-1 flex-col items-center gap-2 overflow-y-auto py-1.5">
        {spaces.map((s, i) => {
          const active = s.name === currentSpace;
          const count = unread[s.name] || 0;
          const mentionCount = mentions[s.name] || 0;
          return (
            // A wrapper, so the reports badge can sit on top of the icon
            // instead of inside its rounded mask (P9-01).
            <div key={s.name} className="relative shrink-0">
              <button
                onClick={() => onSelect(s.name)}
                title={`${s.name} — drag to reorder`}
                aria-label={[s.name, active ? '' : unreadLabel({ unread: count, mentions: mentionCount }), s.openReports ? `${s.openReports} open report${s.openReports === 1 ? '' : 's'}` : ''].filter(Boolean).join(', ')}
                aria-current={active ? 'page' : undefined}
                draggable
                onDragStart={() => setDragIndex(i)}
                onDragOver={(e) => { e.preventDefault(); if (dropIndex !== i) setDropIndex(i); }}
                onDrop={() => handleDrop(i)}
                onDragEnd={() => { setDragIndex(null); setDropIndex(null); }}
                className={`group relative flex h-12 w-12 items-center justify-center overflow-hidden font-semibold text-white transition-all duration-150 hover:rounded-2xl active:scale-90 ${
                  active ? 'rounded-2xl' : 'rounded-[26px]'
                } ${!s.icon && active ? 'bg-brand' : ''} ${dragIndex === i ? 'opacity-40' : ''} ${dropIndex === i && dragIndex !== i ? 'ring-2 ring-fg/70' : ''}`}
                style={{ backgroundColor: s.icon || active ? undefined : colorForName(s.name) }}
              >
                <span
                  className={`absolute -left-3 z-10 w-1 rounded-r bg-fg transition-all ${
                    active ? 'h-8' : count > 0 ? 'h-3' : 'h-0 group-hover:h-5'
                  }`}
                />
                {s.icon ? (
                  <img src={s.icon} alt={s.name} className="h-full w-full object-cover" />
                ) : (
                  initials(s.name)
                )}
              </button>
              {mentionCount > 0 && !active && (
                // Mentions, on top of the icon's bottom-right corner: outside
                // the button like the reports badge, so the mask can't clip it.
                <span
                  aria-hidden="true"
                  data-testid={`mentions-badge-${s.name}`}
                  className="pointer-events-none absolute -bottom-1.5 -right-1.5 z-10 flex h-5 min-w-[20px] items-center justify-center rounded-full border-2 border-ink-900 bg-danger px-1 pt-px text-xs font-bold leading-none text-ink-900"
                >
                  {mentionCount > 99 ? '99+' : mentionCount}
                </span>
              )}
              {s.openReports > 0 && (
                // P9-01: open reports, for the people who handle them, on top of
                // the icon's top-right corner (outside the button, so its mask
                // never clips it, selected or not). Inter's digits sit a little
                // high in their line, so 1px of top padding centers the number.
                <span
                  aria-hidden="true"
                  data-testid={`reports-badge-${s.name}`}
                  className="pointer-events-none absolute -right-1.5 -top-1.5 z-10 flex h-5 min-w-[20px] items-center justify-center rounded-full border-2 border-ink-900 bg-idle px-1 pt-px text-xs font-bold leading-none text-ink-900"
                >
                  {s.openReports > 99 ? '99+' : s.openReports}
                </span>
              )}
            </div>
          );
        })}

        {/* Filled circles are places; outlined ones are actions. */}
        {spaces.length > 0 && <div role="separator" aria-orientation="horizontal" className="my-1 h-px w-8 shrink-0 bg-ink-500/50" />}
        <button
          onClick={() => setDialog({ tab: 'create' })}
          title="Create a server"
          aria-label="Create a server"
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[26px] text-online ring-2 ring-inset ring-ink-500 transition-all hover:rounded-2xl hover:bg-online hover:text-ink-900 hover:ring-online active:scale-90"
        >
          <Icon name="plus" size={24} />
        </button>

        <button
          onClick={() => setDialog({ tab: 'join' })}
          title="Join a server with an invite"
          aria-label="Join a server with an invite"
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[26px] text-gray-300 ring-2 ring-inset ring-ink-500 transition-all hover:rounded-2xl hover:bg-brand hover:text-white hover:ring-brand active:scale-90"
        >
          <Icon name="login" size={20} />
        </button>
      </div>

      {dialog && (
        <CreateServerDialog
          key={dialog.code || dialog.tab}
          initialTab={dialog.tab}
          initialCode={dialog.code}
          onCreate={onCreate}
          onJoin={onJoin}
          onClose={() => setDialog(null)}
        />
      )}
    </nav>
  );
}
