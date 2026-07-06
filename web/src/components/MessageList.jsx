import { useEffect, useRef, useState } from 'react';
import Avatar from './Avatar.jsx';
import Album from './Album.jsx';
import Icon from './Icon.jsx';
import { formatTime, formatDay } from '../util.js';

const REACTION_EMOJIS = ['👍', '❤️', '😂', '🎉', '😮', '😢', '🔥', '✅'];

const MENTION_RE = /(@[A-Za-z0-9_.-]+)/g;

// Render message text with @mentions highlighted (extra-highlighted if it's you).
function renderMentions(content, me) {
  return content.split(MENTION_RE).map((part, i) => {
    if (part[0] === '@') {
      const isMe = part.slice(1) === me;
      return (
        <span
          key={i}
          className={`rounded px-0.5 font-medium ${isMe ? 'bg-brand/40 text-white' : 'bg-brand/15 text-brand'}`}
        >
          {part}
        </span>
      );
    }
    return part;
  });
}

function mentionsUser(content, me) {
  if (!content || !me) return false;
  return content.split(MENTION_RE).some((p) => p[0] === '@' && p.slice(1) === me);
}

// A ||spoiler|| segment: hidden until clicked.
function SpoilerText({ children }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <span
      onClick={() => !revealed && setRevealed(true)}
      title={revealed ? undefined : 'Spoiler — click to reveal'}
      className={
        revealed
          ? 'rounded bg-ink-600/40 px-0.5'
          : 'cursor-pointer select-none rounded bg-ink-500 px-0.5 text-transparent hover:bg-ink-600'
      }
    >
      {children}
    </span>
  );
}

// Render message text with ||spoiler|| segments and (optionally) @mentions.
function renderRich(content, me, withMentions) {
  const nodes = [];
  content.split(/(\|\|[\s\S]+?\|\|)/g).forEach((seg, i) => {
    if (seg.length >= 4 && seg.startsWith('||') && seg.endsWith('||')) {
      nodes.push(<SpoilerText key={`s${i}`}>{seg.slice(2, -2)}</SpoilerText>);
    } else if (seg) {
      nodes.push(withMentions ? <span key={`t${i}`}>{renderMentions(seg, me)}</span> : seg);
    }
  });
  return nodes;
}

// Groups consecutive messages from the same author (within 5 minutes) into a
// single block, and inserts day dividers — the familiar chat reading rhythm.
export default function MessageList({ messages, channel, currentUser, onEdit, onDelete, onReact, simple = false, emptyHeading, emptyBody }) {
  const bottomRef = useRef(null);
  const containerRef = useRef(null);
  // When a channel is first opened (or the transcript was cleared on switch /
  // refresh), the next batch of messages should jump straight to the newest.
  const pendingInitialScroll = useRef(true);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (messages.length === 0) {
      pendingInitialScroll.current = true; // empty transcript → next load lands at the bottom
      return;
    }
    if (pendingInitialScroll.current) {
      pendingInitialScroll.current = false;
      const toBottom = () => bottomRef.current?.scrollIntoView({ block: 'end' });
      toBottom();
      // Content below (images/albums) can settle a frame later and shift things.
      requestAnimationFrame(toBottom);
      return;
    }
    // Subsequent updates: only follow the newest if you're already near the bottom.
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
            <div className="mb-3 flex justify-center">
              {simple ? <span className="text-5xl">💬</span> : <Icon name="hash" size={52} className="text-gray-600" />}
            </div>
            <p className="text-lg font-semibold text-gray-300">
              {emptyHeading || `Welcome to #${channel}`}
            </p>
            <p className="text-sm">{emptyBody || 'This is the start of the channel. Say hello! 👋'}</p>
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
              currentUser={currentUser}
              onEdit={onEdit}
              onDelete={onDelete}
              onReact={onReact}
              simple={simple}
            />
          )
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

function MessageRow({ m, grouped, mine, currentUser, onEdit, onDelete, onReact, simple }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.content || '');
  const [picker, setPicker] = useState(false);
  const reactions = m.reactions || [];
  const mentionsMe = !simple && mentionsUser(m.content, currentUser);

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
    <div
      className={`group relative flex gap-3 px-2 py-0.5 transition-colors hover:bg-ink-600/40 ${grouped ? '' : 'mt-3'} ${
        mentionsMe ? 'border-l-2 border-idle bg-idle/10' : ''
      }`}
    >
      <div className="w-10 shrink-0">
        {grouped ? (
          <span className="hidden w-10 pt-1 text-right text-[10px] text-gray-500 group-hover:inline-block">
            {formatTime(m.timestamp)}
          </span>
        ) : (
          <Avatar name={m.author} size={40} src={m.authorAvatar} />
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
                {renderRich(m.content, currentUser, !simple)}
                {m.editedAt && <span className="ml-1 text-[10px] text-gray-500">(edited)</span>}
              </div>
            )}
            {(m.attachments?.length || m.attachment) && (
              <Album
                items={m.attachments?.length ? m.attachments : [m.attachment]}
                spoiler={m.spoiler}
              />
            )}
            {reactions.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {reactions.map((r) => {
                  const mineReacted = r.users?.includes(currentUser);
                  return (
                    <button
                      key={r.emoji}
                      onClick={() => onReact(m.id, r.emoji)}
                      title={(r.users || []).join(', ')}
                      className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ring-1 transition ${
                        mineReacted
                          ? 'bg-brand/25 text-white ring-brand'
                          : 'bg-ink-600/60 text-gray-200 ring-ink-500/60 hover:ring-brand'
                      }`}
                    >
                      <span>{r.emoji}</span>
                      <span>{r.count}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Hover actions: anyone can react; only the author can edit/delete.
          Each control shows only when its handler is provided (DMs, for
          instance, offer edit/delete but not reactions). */}
      {!editing && (onReact || (mine && (onEdit || onDelete))) && (
        <div className="absolute -top-3 right-3 hidden items-center gap-1 rounded-md border border-ink-500/60 bg-ink-800 px-1 py-0.5 shadow group-hover:flex">
          {onReact && (
            <div className="relative">
              <button
                onClick={() => setPicker((v) => !v)}
                title="Add reaction"
                className="rounded p-1 text-gray-400 hover:bg-ink-600 hover:text-white"
              >
                <Icon name="smile" size={17} />
              </button>
              {picker && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setPicker(false)} />
                  <div className="anim-pop absolute right-0 top-8 z-20 flex gap-1 rounded-lg border border-ink-500/60 bg-ink-900 p-1.5 shadow-xl">
                    {REACTION_EMOJIS.map((e) => (
                      <button
                        key={e}
                        onClick={() => {
                          onReact(m.id, e);
                          setPicker(false);
                        }}
                        className="rounded p-1 text-lg hover:bg-ink-600"
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
          {mine && onEdit && (
            <button
              onClick={startEdit}
              title="Edit"
              className="rounded p-1 text-gray-400 hover:bg-ink-600 hover:text-white"
            >
              <Icon name="edit" size={16} />
            </button>
          )}
          {mine && onDelete && (
            <button
              onClick={() => {
                if (window.confirm('Delete this message?')) onDelete(m.id);
              }}
              title="Delete"
              className="rounded p-1 text-gray-400 hover:bg-ink-600 hover:text-danger"
            >
              <Icon name="trash" size={16} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
