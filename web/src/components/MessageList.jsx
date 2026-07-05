import { useEffect, useRef } from 'react';
import Avatar from './Avatar.jsx';
import Attachment from './Attachment.jsx';
import { formatTime, formatDay } from '../util.js';

// Groups consecutive messages from the same author (within 5 minutes) into a
// single block, and inserts day dividers — the familiar chat reading rhythm.
export default function MessageList({ messages, channel }) {
  const bottomRef = useRef(null);
  const containerRef = useRef(null);

  // Auto-scroll to newest, but only if the user is already near the bottom.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (nearBottom) bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  const rows = [];
  let lastAuthor = null;
  let lastTs = 0;
  let lastDay = '';

  messages.forEach((m) => {
    const day = formatDay(m.timestamp);
    if (day !== lastDay) {
      rows.push({ kind: 'divider', key: `d-${m.id}`, day });
      lastDay = day;
      lastAuthor = null;
    }
    const grouped = m.author === lastAuthor && m.timestamp - lastTs < 5 * 60 * 1000;
    rows.push({ kind: 'msg', key: m.id, m, grouped });
    lastAuthor = m.author;
    lastTs = m.timestamp;
  });

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto">
      <div className="flex min-h-full flex-col justify-end px-4 py-4">
        {messages.length === 0 && (
          <div className="py-10 text-center text-gray-500">
            <div className="mb-2 text-5xl">#</div>
            <p className="text-lg font-semibold text-gray-300">Welcome to #{channel}</p>
            <p className="text-sm">This is the start of the channel. Say hello! 👋</p>
          </div>
        )}

        {rows.map((row) =>
          row.kind === 'divider' ? (
            <div key={row.key} className="my-3 flex items-center gap-3 text-xs text-gray-500">
              <div className="h-px flex-1 bg-ink-500/40" />
              <span>{row.day}</span>
              <div className="h-px flex-1 bg-ink-500/40" />
            </div>
          ) : (
            <MessageRow key={row.key} m={row.m} grouped={row.grouped} />
          )
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

function MessageRow({ m, grouped }) {
  return (
    <div className={`group flex gap-3 px-2 hover:bg-ink-600/30 ${grouped ? 'py-0.5' : 'mt-3 py-0.5'}`}>
      <div className="w-10 shrink-0">
        {grouped ? (
          <span className="hidden w-10 pt-1 text-right text-[10px] text-gray-500 group-hover:inline-block">
            {formatTime(m.timestamp)}
          </span>
        ) : (
          <Avatar name={m.author} size={40} />
        )}
      </div>
      <div className="min-w-0 flex-1">
        {!grouped && (
          <div className="flex items-baseline gap-2">
            <span className="font-semibold text-gray-100">{m.author || 'Unknown'}</span>
            <span className="text-xs text-gray-500">{formatTime(m.timestamp)}</span>
          </div>
        )}
        {m.content && <div className="whitespace-pre-wrap break-words text-gray-200">{m.content}</div>}
        {m.attachment && <Attachment url={m.attachment} />}
      </div>
    </div>
  );
}
