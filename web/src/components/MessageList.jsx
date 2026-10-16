import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Avatar from './Avatar.jsx';
import Album from './Album.jsx';
import Icon from './Icon.jsx';
import { MessageToolbar, ActionMenu, ReactionPicker } from './MessageActions.jsx';
import { formatTime, formatDay } from '../util.js';
import { renderMarkdown } from '../markdown.jsx';
import { newDivider } from '../newMessages.js';

const LONG_PRESS_MS = 450;
const JUMP_MAX_PAGES = 10; // how far back "Jump" will page before giving up
const LONG_PRESS_SLOP_PX = 10;

const MENTION_RE = /(@[A-Za-z0-9_.-]+)/g;

// Whether a message mentions you (for the row highlight).
function mentionsUser(content, me) {
  if (!content || !me) return false;
  return content.split(MENTION_RE).some((p) => p[0] === '@' && p.slice(1) === me);
}

// Groups consecutive messages from the same author (within 5 minutes) into a
// single block, and inserts day dividers — the familiar chat reading rhythm.
// `canModerate(author)` (optional) says whether you may delete that author's
// messages as a moderator.
// `onReply(message)` (optional) adds a Reply action. `onLoadOlder` (optional)
// is called when you scroll near the top while `hasMore`; it may return a
// promise that settles once the page is in. `newMessages` ({ since, count },
// optional) draws a "New" divider after the last message you'd read, with a
// bar to jump back to it when it's out of view.
export default function MessageList({ messages, channel, currentUser, onEdit, onDelete, onReact, onReply, canModerate, hasMore = false, loadingOlder = false, onLoadOlder, newMessages = null, simple = false, emptyHeading, emptyBody }) {
  const bottomRef = useRef(null);
  const containerRef = useRef(null);
  // When a channel is first opened (or the transcript was cleared on switch /
  // refresh), the next batch of messages should jump straight to the newest.
  const pendingInitialScroll = useRef(true);
  // Roving tabindex: the list is one tab stop, and the arrow keys move between
  // messages. `activeId` is the row Tab lands on (defaults to the newest).
  const [activeId, setActiveId] = useState(null);
  // Briefly highlighted message after jumping to a reply's original, and a
  // short note when the original isn't loaded.
  const [flashId, setFlashId] = useState(null);
  const [jumpNote, setJumpNote] = useState('');
  const timers = useRef([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // ---- "New" divider and the jump bar ----
  const divider = newMessages ? newDivider(messages, newMessages.since, currentUser, hasMore) : null;
  const [barDismissed, setBarDismissed] = useState(false);
  const [dividerAbove, setDividerAbove] = useState(false);
  const [jumping, setJumping] = useState(false);
  useEffect(() => setBarDismissed(false), [newMessages]);
  // The latest props, for the jump loop (which awaits across renders).
  const live = useRef({});
  live.current = { messages, hasMore, loadingOlder, onLoadOlder, newMessages, currentUser };

  // Is the divider out of view above (or not loaded yet)?
  function checkDivider() {
    const el = containerRef.current;
    if (!el) return;
    const d = el.querySelector('[data-new-divider]');
    setDividerAbove(!d || d.getBoundingClientRect().bottom < el.getBoundingClientRect().top);
  }
  useEffect(checkDivider, [messages, newMessages]);

  const showBar = !!divider && !barDismissed && dividerAbove;

  // Esc dismisses the bar, unless you're typing or a popup handled it.
  useEffect(() => {
    if (!showBar) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (e.target.closest?.('input, textarea, [contenteditable="true"]')) return;
      setBarDismissed(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showBar]);

  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

  // Page back until the first new message is loaded, then scroll to it.
  async function jumpToNew() {
    setJumping(true);
    const where = () => {
      const l = live.current;
      return l.newMessages ? newDivider(l.messages, l.newMessages.since, l.currentUser, l.hasMore) : null;
    };
    for (let pages = 0; where() && !where().loaded && pages < JUMP_MAX_PAGES; pages++) {
      const el = containerRef.current;
      if (el) prependAnchor.current = { height: el.scrollHeight, top: el.scrollTop };
      await live.current.onLoadOlder?.();
      // Let React render the new page before looking again.
      for (let i = 0; i < 20 && live.current.loadingOlder; i++) await nextFrame();
      await nextFrame();
      if (!live.current.hasMore) break;
    }
    setJumping(false);
    const target = containerRef.current?.querySelector('[data-new-divider]');
    if (target) {
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } else {
      setJumpNote('The first new message is too far back to jump to. Scroll up to keep reading.');
      timers.current.push(setTimeout(() => setJumpNote(''), 4000));
    }
  }

  function jumpTo(id) {
    const el = containerRef.current?.querySelector(`[data-msg-id="${id}"]`);
    if (!el) {
      setJumpNote('The original message is further up in the history.');
      timers.current.push(setTimeout(() => setJumpNote(''), 3000));
      return;
    }
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.focus({ preventScroll: true });
    setFlashId(id);
    timers.current.push(setTimeout(() => setFlashId((cur) => (cur === id ? null : cur)), 2000));
  }

  // Loading older messages: a sentinel at the top asks for the next page, and
  // the scroll position is restored after the prepend so the view doesn't jump.
  const topSentinel = useRef(null);
  const prependAnchor = useRef(null); // { height, top } captured before a load
  const firstIdRef = useRef(null);
  const loadOlderRef = useRef(null);
  loadOlderRef.current = hasMore && !loadingOlder && onLoadOlder ? onLoadOlder : null;

  useEffect(() => {
    const el = containerRef.current;
    const sentinel = topSentinel.current;
    if (!el || !sentinel || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting) || !loadOlderRef.current) return;
        prependAnchor.current = { height: el.scrollHeight, top: el.scrollTop };
        loadOlderRef.current();
      },
      { root: el, rootMargin: '300px 0px 0px 0px' }
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, [hasMore, loadingOlder]);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const firstId = messages[0]?.id;
    const prepended = prependAnchor.current && firstIdRef.current != null && firstId !== firstIdRef.current;
    firstIdRef.current = firstId ?? null;
    if (prepended) {
      // Older messages were added above: keep what you were looking at in place.
      el.scrollTop = prependAnchor.current.top + (el.scrollHeight - prependAnchor.current.height);
      prependAnchor.current = null;
      return;
    }
    if (messages.length === 0) {
      prependAnchor.current = null;
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

  const tabStopId = messages.some((m) => m.id === activeId)
    ? activeId
    : messages.length ? messages[messages.length - 1].id : null;

  // Move focus to the previous/next message row (dir = -1 / +1).
  function focusSibling(fromEl, dir) {
    const rowEls = [...(containerRef.current?.querySelectorAll('[data-msg-row]') || [])];
    const next = rowEls[rowEls.indexOf(fromEl) + dir];
    if (next) {
      next.focus();
      next.scrollIntoView({ block: 'nearest' });
    }
  }

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
    // The "New" divider also starts a new block, so the first new message
    // shows its author.
    if (divider?.id === m.id) {
      rows.push({ kind: 'new', key: 'new-divider' });
      lastAuthor = null;
    }
    // A reply always starts a new block, so its quote line sits under a header.
    const grouped = !m.replyTo && m.author === lastAuthor && m.timestamp - lastTs < 5 * 60 * 1000;
    rows.push({ kind: 'msg', key: m.id, m, grouped });
    lastAuthor = m.author;
    lastTs = m.timestamp;
  });

  return (
    <div ref={containerRef} onScroll={divider ? checkDivider : undefined} className="relative flex-1 overflow-y-auto">
      {showBar && (
        <div className="anim-slide-down sticky top-0 z-30 flex items-center gap-3 bg-brand px-4 py-1.5 text-sm text-white shadow-md">
          <span className="min-w-0 flex-1 truncate">
            {newMessages.count} new message{newMessages.count === 1 ? '' : 's'}
            {divider.loaded && (() => {
              const first = messages.find((x) => x.id === divider.id);
              return first ? ` since ${formatTime(first.timestamp)}` : '';
            })()}
          </span>
          <button
            type="button"
            onClick={jumpToNew}
            disabled={jumping}
            className="shrink-0 font-semibold hover:underline disabled:opacity-60"
          >
            {jumping ? 'Jumping…' : 'Jump'}
          </button>
          <button type="button" onClick={() => setBarDismissed(true)} className="shrink-0 hover:underline">
            Mark as read
          </button>
        </div>
      )}
      {jumpNote && (
        <div role="status" className="anim-pop sticky top-2 z-30 mx-auto w-fit rounded-full bg-ink-900 px-4 py-1.5 text-sm text-gray-200 shadow-lg ring-1 ring-ink-500/60">
          {jumpNote}
        </div>
      )}
      <div
        role="log"
        aria-label={simple ? 'Messages' : `Messages in #${channel}`}
        className="flex min-h-full flex-col justify-end px-4 py-4"
      >
        <div ref={topSentinel} aria-hidden="true" />
        {loadingOlder && (
          <div role="status" className="flex items-center justify-center gap-2 py-3 text-sm text-gray-500">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-gray-500 border-t-transparent" aria-hidden="true" />
            Loading older messages…
          </div>
        )}
        {/* The start of the conversation: shown when empty, or once you've
            scrolled back to the very first message. */}
        {!hasMore && !loadingOlder && (
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
          row.kind === 'new' ? (
            <div
              key={row.key}
              data-new-divider
              role="separator"
              aria-label="New messages"
              className="mb-1 mt-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-pink"
            >
              <div className="h-px flex-1 bg-pink/70" />
              <span>New</span>
            </div>
          ) : row.kind === 'divider' ? (
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
              canDelete={!!onDelete && (row.m.author === currentUser || !!canModerate?.(row.m.author))}
              onReact={onReact}
              onReply={onReply}
              onJumpTo={jumpTo}
              flash={row.m.id === flashId}
              simple={simple}
              tabIndex={row.m.id === tabStopId ? 0 : -1}
              onFocusRow={() => setActiveId(row.m.id)}
              onNavigate={focusSibling}
            />
          )
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

function MessageRow({ m, grouped, mine, currentUser, onEdit, onDelete, canDelete, onReact, onReply, onJumpTo, flash, simple, tabIndex, onFocusRow, onNavigate }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.content || '');
  // Which popup is open: null | 'menu' | 'react'. `sheet` shows it as a touch
  // bottom sheet instead of a popover.
  const [popup, setPopup] = useState(null);
  const [sheet, setSheet] = useState(false);
  const [above, setAbove] = useState(false);
  const rowRef = useRef(null);
  const press = useRef(null);
  const longPressed = useRef(false);
  const lastPointer = useRef('mouse');
  const reactions = m.reactions || [];
  const mentionsMe = !simple && mentionsUser(m.content, currentUser);

  useEffect(() => () => press.current && clearTimeout(press.current.timer), []);

  // Return focus to this row after a popup or edit closes (next frame, once the
  // popup is gone) — but never pull it from somewhere the user has moved to,
  // such as the composer.
  const focusRow = () =>
    requestAnimationFrame(() => {
      const row = rowRef.current;
      const active = document.activeElement;
      if (row && (!active || active === document.body || row.contains(active))) row.focus();
    });

  function openPopup(kind, asSheet) {
    // The list scrolls and clips its content, so a popover near the bottom
    // opens upward instead of being cut off.
    const row = rowRef.current;
    const scroller = row?.closest('.overflow-y-auto');
    if (row && scroller) {
      const needed = kind === 'menu' ? actions.length * 36 + 40 : 72;
      setAbove(scroller.getBoundingClientRect().bottom - row.getBoundingClientRect().top < needed);
    }
    setSheet(asSheet);
    setPopup(kind);
  }

  function closePopup() {
    setPopup(null);
    focusRow();
  }

  function startEdit() {
    setPopup(null);
    setDraft(m.content || '');
    setEditing(true);
  }

  function finishEdit() {
    setEditing(false);
    focusRow();
  }

  function saveEdit() {
    const next = draft.trim();
    if (next && next !== m.content) onEdit(m.id, next);
    finishEdit();
  }

  function confirmDelete() {
    setPopup(null);
    const question = mine ? 'Delete this message?' : `Delete this message from ${m.author || 'this user'}?`;
    if (window.confirm(question)) onDelete(m.id);
    else focusRow();
  }

  function pickReaction(emoji) {
    onReact(m.id, emoji);
    closePopup();
  }

  // One list drives the toolbar, the "…" menu, right-click and the touch sheet.
  // Anyone can react; only the author can edit; the author or a moderator can
  // delete. Each item shows only when its handler is provided (DMs offer
  // edit/delete but not reactions).
  const actions = [
    onReply && {
      id: 'reply', label: 'Reply', icon: 'reply', quick: true,
      onSelect: () => {
        setPopup(null);
        onReply(m);
      },
    },
    m.replyTo && !m.replyTo.deleted && {
      id: 'jump', label: 'Jump to original', icon: 'reply',
      onSelect: () => {
        setPopup(null);
        onJumpTo(m.replyTo.id);
      },
    },
    onReact && {
      id: 'react', label: 'Add reaction', icon: 'smile', quick: true,
      // From the touch sheet, the emoji choices open as a sheet too.
      onSelect: () => openPopup('react', popup === 'menu' && sheet),
    },
    mine && onEdit && { id: 'edit', label: 'Edit message', icon: 'edit', quick: true, onSelect: startEdit },
    m.content && {
      id: 'copy', label: 'Copy text', icon: 'copy',
      onSelect: () => {
        navigator.clipboard?.writeText(m.content).catch(() => {});
        closePopup();
      },
    },
    // Your own messages, or others' when you can moderate them.
    canDelete && { id: 'delete', label: 'Delete message', icon: 'trash', danger: true, quick: true, onSelect: confirmDelete },
  ].filter(Boolean);

  function onEditKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      saveEdit();
    } else if (e.key === 'Escape') {
      finishEdit();
    }
  }

  // Keys on the focused row itself (not on buttons or the edit box inside it).
  function onRowKeyDown(e) {
    if (e.target !== rowRef.current) return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      onNavigate(rowRef.current, e.key === 'ArrowUp' ? -1 : 1);
    } else if (e.key === 'Enter' && actions.length) {
      e.preventDefault();
      openPopup('menu', false);
    } else if ((e.key === 'r' || e.key === 'R') && onReply) {
      e.preventDefault();
      onReply(m);
    } else if ((e.key === 'e' || e.key === 'E') && mine && onEdit) {
      e.preventDefault();
      startEdit();
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && canDelete) {
      e.preventDefault();
      confirmDelete();
    }
  }

  // Touch: a steady long-press opens the action sheet; moving (scrolling)
  // cancels it.
  function cancelPress() {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  }
  function onPointerDown(e) {
    lastPointer.current = e.pointerType;
    if (e.pointerType !== 'touch' || editing || !actions.length) return;
    cancelPress();
    press.current = {
      x: e.clientX,
      y: e.clientY,
      timer: setTimeout(() => {
        press.current = null;
        longPressed.current = true;
        navigator.vibrate?.(10);
        openPopup('menu', true);
      }, LONG_PRESS_MS),
    };
  }
  function onPointerMove(e) {
    if (press.current && Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) > LONG_PRESS_SLOP_PX) {
      cancelPress();
    }
  }
  function onPointerUp() {
    cancelPress();
    // The click that follows this lift (if the browser sends one) is swallowed
    // below. Clear the flag shortly after, so a browser that sends no click
    // doesn't eat the user's first tap in the sheet.
    if (longPressed.current) setTimeout(() => { longPressed.current = false; }, 50);
  }
  // Swallow the click that follows a long-press so it doesn't hit an image.
  function onClickCapture(e) {
    if (longPressed.current) {
      longPressed.current = false;
      e.preventDefault();
      e.stopPropagation();
    }
  }
  // Right-click (and Android's long-press context menu) opens the same menu.
  function onContextMenu(e) {
    if (editing || !actions.length) return;
    e.preventDefault();
    openPopup('menu', lastPointer.current === 'touch');
  }

  const hasAttachment = m.attachments?.length || m.attachment;
  const replyLabel = m.replyTo ? (m.replyTo.deleted ? 'replying to a deleted message, ' : `replying to ${m.replyTo.author}, `) : '';
  const label = `${m.author || 'Unknown'}, ${formatTime(m.timestamp)}, ${replyLabel}${m.content || (hasAttachment ? 'attachment' : '')}`;

  return (
    <div
      ref={rowRef}
      data-msg-row
      data-msg-id={m.id}
      role="article"
      aria-label={label}
      tabIndex={tabIndex}
      onFocus={(e) => e.target === rowRef.current && onFocusRow()}
      onKeyDown={onRowKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={cancelPress}
      onPointerLeave={cancelPress}
      onClickCapture={onClickCapture}
      onContextMenu={onContextMenu}
      className={`group relative flex gap-3 px-2 py-0.5 outline-none transition-colors hover:bg-ink-600/40 focus-visible:bg-ink-600/40 focus-visible:ring-1 focus-visible:ring-brand-hi [-webkit-touch-callout:none] [@media(hover:none)]:select-none ${
        grouped ? '' : 'mt-3'
      } ${mentionsMe ? 'border-l-2 border-pink bg-pink/10' : ''} ${flash ? '!bg-brand/20 ring-1 ring-brand-hi/60' : ''}`}
    >
      <div className="w-10 shrink-0">
        {grouped ? (
          <span className="hidden w-10 pt-1 text-right text-[10px] text-gray-500 group-hover:inline-block group-focus-visible:inline-block">
            {formatTime(m.timestamp)}
          </span>
        ) : (
          <Avatar name={m.author} size={40} src={m.authorAvatar} />
        )}
      </div>

      <div className="min-w-0 flex-1">
        {m.replyTo && (
          m.replyTo.deleted ? (
            <div className="mb-0.5 flex items-center gap-1.5 text-xs italic text-gray-500">
              <Icon name="reply" size={12} className="shrink-0" />
              Original message was deleted
            </div>
          ) : (
            <button
              type="button"
              tabIndex={-1}
              onClick={() => onJumpTo(m.replyTo.id)}
              title="Jump to the original message"
              className="mb-0.5 flex max-w-full items-center gap-1.5 text-left text-xs text-gray-400 hover:text-gray-200"
            >
              <Icon name="reply" size={12} className="shrink-0" />
              <span className="shrink-0 font-semibold text-brand-hi">@{m.replyTo.author}</span>
              <span className="truncate">{m.replyTo.snippet}</span>
            </button>
          )
        )}
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
              onKeyDown={onEditKeyDown}
              rows={1}
              aria-label="Edit message"
              className="w-full resize-none rounded-lg bg-ink-800 px-3 py-2 text-gray-100 outline-none ring-1 ring-ink-500 focus:ring-brand-hi"
            />
            <div className="mt-1 text-xs text-gray-500">
              escape to{' '}
              <button className="text-brand-hi hover:underline" onClick={finishEdit}>
                cancel
              </button>{' '}
              · enter to{' '}
              <button className="text-brand-hi hover:underline" onClick={saveEdit}>
                save
              </button>
            </div>
          </div>
        ) : (
          <>
            {m.content && (
              <div className="whitespace-pre-wrap break-words text-gray-200">
                {renderMarkdown(m.content, { me: currentUser, mentions: !simple })}
                {m.editedAt && <span className="ml-1 text-[10px] text-gray-500">(edited)</span>}
              </div>
            )}
            {hasAttachment && (
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
                      aria-label={`${r.emoji} ${r.count}${mineReacted ? ', you reacted' : ''}`}
                      aria-pressed={!!mineReacted}
                      className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ring-1 transition ${
                        mineReacted
                          ? 'bg-brand/25 text-white ring-brand-hi'
                          : 'bg-ink-600/60 text-gray-200 ring-ink-500/60 hover:ring-brand-hi'
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

      {!editing && actions.length > 0 && (
        <MessageToolbar
          actions={actions}
          forceVisible={popup !== null && !sheet}
          onOpenMenu={() => openPopup('menu', false)}
        />
      )}
      {popup === 'menu' && (
        <ActionMenu actions={actions} sheet={sheet} above={above} onClose={closePopup} label="Message actions" />
      )}
      {popup === 'react' && <ReactionPicker sheet={sheet} above={above} onPick={pickReaction} onClose={closePopup} />}
    </div>
  );
}
