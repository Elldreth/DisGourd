import { useEffect, useRef, useState } from 'react';
import Avatar from './Avatar.jsx';
import Attachment from './Attachment.jsx';
import { formatTime, formatDay } from '../util.js';

// Groups consecutive messages from the same author (within 5 minutes) into a
// single block, and inserts day dividers — the familiar chat reading rhythm.
export default function MessageList({ messages, channel, currentUser, onEdit, onDelete }) {
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
            <MessageRow
              key={row.key}
              m={row.m}
              grouped={row.grouped}
              mine={row.m.author === currentUser}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          )
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

function MessageRow({ m, grouped, mine, onEdit, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.content || '');

  function startEdit() {
    setDraft(m.content || '');
    setEditing(true);
  }

  function saveEdit() {
    const next = draft.trim();
    if (next && next !== m.content) onEdit(m.id, next);
    setEditing(false);
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      saveEdit();
    } else if (e.key === 'Escape') {
      setEditing(false);
    }
  }

  return (
    <div className={`group relative flex gap-3 px-2 hover:bg-ink-600/30 ${grouped ? 'py-0.5' : 'mt-3 py-0.5'}`}>
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

        {editing ? (
          <div className="mt-1">
            <textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              className="w-full resize-none rounded-lg bg-ink-800 px-3 py-2 text-gray-100 outline-none ring-1 ring-ink-500 focus:ring-brand"
            />
            <div className="mt-1 text-xs text-gray-500">
              escape to{' '}
              <button className="text-brand hover:underline" onClick={() => setEditing(false)}>
                cancel
              </button>{' '}
              · enter to{' '}
              <button className="text-brand hover:underline" onClick={saveEdit}>
                save
              </button>
            </div>
          </div>
        ) : (
          <>
            {m.content && (
              <div className="whitespace-pre-wrap break-words text-gray-200">
                {m.content}
                {m.editedAt && <span className="ml-1 text-[10px] text-gray-500">(edited)</span>}
              </div>
            )}
            {m.attachment && <Attachment url={m.attachment} />}
          </>
        )}
      </div>

      {/* Hover actions for your own messages */}
      {mine && !editing && (
        <div className="absolute -top-3 right-3 hidden items-center gap-1 rounded-md border border-ink-500/60 bg-ink-800 px-1 py-0.5 shadow group-hover:flex">
          <button
            onClick={startEdit}
            title="Edit"
            className="rounded p-1 text-gray-400 hover:bg-ink-600 hover:text-white"
          >
            ✎
          </button>
          <button
            onClick={() => {
              if (window.confirm('Delete this message?')) onDelete(m.id);
            }}
            title="Delete"
            className="rounded p-1 text-gray-400 hover:bg-ink-600 hover:text-danger"
          >
            🗑
          </button>
        </div>
      )}
    </div>
  );
}
