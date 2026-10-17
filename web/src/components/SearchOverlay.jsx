import { useEffect, useId, useRef, useState } from 'react';
import * as api from '../api.js';
import Avatar from './Avatar.jsx';
import Icon from './Icon.jsx';
import { formatTime, formatDay } from '../util.js';
import Modal from './Modal.jsx';

// A search palette over all messages the user can see (server channels + DMs).
// A Modal dialog with a combobox: type, then ↓ / ↑ to move through the
// results and Enter to open one; the mouse works too.
// A result from a thread shows "Thread name (#parent)" and opens the thread
// (`onOpenThread(space, thread)`) rather than switching channel.
export default function SearchOverlay({ onClose, onOpenChannel, onOpenDm, onOpenThread }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState({ channels: [], dms: [] });
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1); // highlighted result, -1 = none
  const timerRef = useRef(null);
  const inputRef = useRef(null);
  const listId = useId();

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults({ channels: [], dms: [] });
      return undefined;
    }
    setLoading(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      api
        .search(term)
        .then((r) => setResults(r))
        .catch(() => {})
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(timerRef.current);
  }, [q]);

  const total = results.channels.length + results.dms.length;
  const short = q.trim().length < 2;
  // Every result in display order, with what opening it does.
  const flat = [
    ...results.channels.map((m) => ({ key: `c${m.id}`, m, open: () => openResult(m) })),
    ...results.dms.map((m) => ({ key: `d${m.id}`, m, open: () => onOpenDm(m.dmWith) })),
  ];
  const optionId = (i) => `${listId}-${i}`;
  const openResult = (m) => (m.thread && onOpenThread ? onOpenThread(m.space, m.thread) : onOpenChannel(m.space, m.channel));
  const whereOf = (m) => (m.thread ? `${m.thread.name} (#${m.thread.parentChannel}) · ${m.space}` : `#${m.channel} · ${m.space}`);
  useEffect(() => setActive(-1), [results]);

  function onKeyDown(e) {
    if (e.key === 'ArrowDown' && flat.length) {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, flat.length - 1));
    } else if (e.key === 'ArrowUp' && flat.length) {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && flat[active]) {
      e.preventDefault();
      flat[active].open();
    }
  }

  // Keep the highlighted result in view.
  useEffect(() => {
    if (active >= 0) document.getElementById(optionId(active))?.scrollIntoView?.({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return (
    <Modal
      onClose={onClose}
      label="Search messages"
      initialFocusRef={inputRef}
      backdropClassName="flex items-start justify-center bg-black/60 p-4 pt-20"
      panelClassName="flex max-h-[70vh] w-full max-w-2xl flex-col rounded-xl bg-ink-800 shadow-2xl ring-1 ring-ink-500/50"
    >
        <div className="flex items-center gap-2 border-b border-ink-500/40 p-3">
          <Icon name="search" size={18} className="shrink-0 text-gray-400" />
          <input
            ref={inputRef}
            role="combobox"
            aria-label="Search messages"
            aria-expanded={flat.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 ? optionId(active) : undefined}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search messages…"
            className="flex-1 bg-transparent text-gray-100 outline-hidden placeholder:text-gray-500"
          />
          <button onClick={onClose} aria-label="Close search" className="rounded-sm px-2 text-xs text-gray-400 hover:text-fg">
            esc
          </button>
        </div>

        <div id={listId} role="listbox" aria-label="Results" className="flex-1 overflow-y-auto p-2">
          {short && <p className="p-4 text-center text-sm text-gray-500">Type at least 2 characters to search.</p>}
          {!short && !loading && total === 0 && (
            <p className="p-4 text-center text-sm text-gray-500">No messages found.</p>
          )}
          {results.channels.length > 0 && (
            <Section label="In servers">
              {results.channels.map((m, i) => (
                <ResultRow
                  key={`c${m.id}`}
                  id={optionId(i)}
                  selected={active === i}
                  m={m}
                  where={whereOf(m)}
                  onClick={() => openResult(m)}
                />
              ))}
            </Section>
          )}
          {results.dms.length > 0 && (
            <Section label="Direct messages">
              {results.dms.map((m, j) => {
                const i = results.channels.length + j;
                return (
                  <ResultRow
                    key={`d${m.id}`}
                    id={optionId(i)}
                    selected={active === i}
                    m={m}
                    where={`@${m.dmWith}`}
                    onClick={() => onOpenDm(m.dmWith)}
                  />
                );
              })}
            </Section>
          )}
        </div>
    </Modal>
  );
}

function Section({ label, children }) {
  return (
    <div role="group" aria-label={label} className="mb-2">
      <div aria-hidden="true" className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</div>
      {children}
    </div>
  );
}

function ResultRow({ id, selected, m, where, onClick }) {
  return (
    <button
      id={id}
      role="option"
      aria-selected={selected}
      tabIndex={-1}
      onClick={onClick}
      className={`flex w-full items-start gap-3 rounded-sm px-2 py-2 text-left transition hover:bg-ink-600/50 ${selected ? 'bg-ink-600/50' : ''}`}
    >
      <Avatar name={m.author} size={32} src={m.authorAvatar} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-gray-100">{m.author || 'Unknown'}</span>
          <span className="truncate text-xs text-gray-500">
            {where} · {formatDay(m.timestamp)} {formatTime(m.timestamp)}
          </span>
        </div>
        <div className="truncate text-sm text-gray-300">{m.content}</div>
      </div>
    </button>
  );
}
