import { useEffect, useRef, useState } from 'react';
import * as api from '../api.js';
import Avatar from './Avatar.jsx';
import Icon from './Icon.jsx';
import { formatTime, formatDay } from '../util.js';

// A search palette over all messages the user can see (server channels + DMs).
export default function SearchOverlay({ onClose, onOpenChannel, onOpenDm }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState({ channels: [], dms: [] });
  const [loading, setLoading] = useState(false);
  const timerRef = useRef(null);

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

  return (
    <div
      className="anim-fade absolute inset-0 z-30 flex items-start justify-center bg-black/60 p-4 pt-20"
      onClick={onClose}
    >
      <div
        className="anim-scale-in flex max-h-[70vh] w-full max-w-2xl flex-col rounded-xl bg-ink-800 shadow-2xl ring-1 ring-ink-500/50"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-ink-500/40 p-3">
          <Icon name="search" size={18} className="shrink-0 text-gray-400" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && onClose()}
            placeholder="Search messages…"
            className="flex-1 bg-transparent text-gray-100 outline-none placeholder:text-gray-500"
          />
          <button onClick={onClose} className="rounded px-2 text-xs text-gray-400 hover:text-white">
            esc
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {short && <p className="p-4 text-center text-sm text-gray-500">Type at least 2 characters to search.</p>}
          {!short && !loading && total === 0 && (
            <p className="p-4 text-center text-sm text-gray-500">No messages found.</p>
          )}
          {results.channels.length > 0 && (
            <Section label="In servers">
              {results.channels.map((m) => (
                <ResultRow
                  key={`c${m.id}`}
                  m={m}
                  where={`#${m.channel} · ${m.space}`}
                  onClick={() => onOpenChannel(m.space, m.channel)}
                />
              ))}
            </Section>
          )}
          {results.dms.length > 0 && (
            <Section label="Direct messages">
              {results.dms.map((m) => (
                <ResultRow key={`d${m.id}`} m={m} where={`@${m.dmWith}`} onClick={() => onOpenDm(m.dmWith)} />
              ))}
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ label, children }) {
  return (
    <div className="mb-2">
      <div className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</div>
      {children}
    </div>
  );
}

function ResultRow({ m, where, onClick }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-start gap-3 rounded px-2 py-2 text-left transition hover:bg-ink-600/50"
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
