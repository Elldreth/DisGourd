import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import RoleName from './RoleName.jsx';
import Avatar from './Avatar.jsx';
import Album from './Album.jsx';
import Embed from './Embed.jsx';
import ImagineAgain, { imagineResultKind } from './ImagineAgain.jsx';
import Icon from './Icon.jsx';
import EmptyState from './EmptyState.jsx';
import { MessageToolbar, ActionMenu, ReactionPicker } from './MessageActions.jsx';
import { formatTime, formatDay, formatAgo } from '../util.js';
import EditHistoryDialog from './EditHistoryDialog.jsx';
import { renderMarkdown } from '../markdown.jsx';
import { newDivider } from '../newMessages.js';
import { emojiLookup, parseEmojiToken } from '../emoji.js';
import { useBlocked } from '../state/useBlocks.js';

const LONG_PRESS_MS = 450;
const JUMP_MAX_PAGES = 10; // how far back "Jump" will page before giving up
const LONG_PRESS_SLOP_PX = 10;

const MENTION_RE = /(@[A-Za-z0-9_.-]+)/g;

// "No replies yet", "1 reply", "4 replies".
const replyCount = (n) => (!n ? 'No replies yet' : n === 1 ? '1 reply' : `${n} replies`);

// The line under a root message: "Thread name · 3 replies · last 5 min ago",
// with a dot (or a mention count) when the thread has something unread.
function ThreadSummary({ thread, badge, onOpen }) {
  const unread = badge?.unread || 0;
  const mentions = badge?.mentions || 0;
  const state = mentions ? `, ${mentions === 1 ? '1 mention' : `${mentions} mentions`}` : unread ? ', unread' : '';
  return (
    <button
      type="button"
      tabIndex={-1}
      onClick={(e) => onOpen(e.currentTarget)}
      aria-label={`Open thread ${thread.name}, ${replyCount(thread.messageCount)}${thread.archived ? ', archived' : ''}${state}`}
      className={`tap-chip mt-1.5 flex max-w-full items-center gap-2 rounded-md bg-ink-800/70 px-2 py-1 text-xs ring-1 transition hover:ring-brand-hi ${
        unread || mentions ? 'ring-brand-hi/60' : 'ring-ink-500/60'
      }`}
    >
      <Icon name="thread" size={14} className="shrink-0 text-brand-hi" />
      <span className={`min-w-0 flex-1 truncate text-left ${unread || mentions ? 'font-bold text-fg' : 'font-semibold text-gray-100'}`}>{thread.name}</span>
      <span className="shrink-0 text-gray-400">· {replyCount(thread.messageCount)}</span>
      {thread.messageCount > 0 && (
        <span className="shrink-0 text-gray-400 max-[360px]:hidden">· last {formatAgo(thread.lastActivityAt)}</span>
      )}
      {thread.archived && <span className="shrink-0 text-gray-400">· archived</span>}
      {mentions > 0 ? (
        <span aria-hidden="true" className="shrink-0 rounded-full bg-pink px-1.5 text-[10px] font-bold leading-4 text-ink-900">{mentions}</span>
      ) : unread > 0 ? (
        <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-brand-hi" />
      ) : null}
    </button>
  );
}

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
// `onEditDone` (optional) is called when an edit started by `startEditLast()`
// (the composer's up arrow) ends, so the composer can take focus back.
// `onPin(id, pinned)` (optional, only when you may pin) adds Pin / Unpin.
// `onCreateThread(message)` (optional) adds Create thread to messages without
// one; `onOpenThread(thread, message, opener)` (optional) draws the summary
// under a message that has a thread, and adds Open thread. `opener` is the
// element to give focus back to when the thread closes.
// `threadBadge(channel)` (optional) gives a thread's { unread, mentions } for its summary.
// `emoji` (optional): the server's custom emoji [{ id, name, url }], for :name:
// in messages, reaction chips and the reaction picker.
// `label` (optional) names the list (default "Messages in #channel").
// `history` (optional, see state/historyWindow.js) lets a reply's quote jump to
// an original that isn't loaded, and, while that older window is showing
// (`history.hasNewer`), offers newer pages and "Jump to present".
const MessageList = forwardRef(function MessageList({ messages, channel, currentUser, onEdit, onDelete, onReact, onReply, canModerate, hasMore = false, loadingOlder = false, onLoadOlder, newMessages = null, onEditDone, onHidePreview, imagineAgain = null, imagineUpscale = false, imaginePictures = null, simple = false, emptyHeading, emptyBody, emptyIcon = null, emptyArt = null, topAligned = false, history = null, onPin, onCreateThread, onOpenThread, threadBadge, label, emoji = [], loadVersions, onReport }, ref) {
  const bottomRef = useRef(null);
  // P9-07b: messages from people I've blocked are collapsed until shown
  // (per message, until the channel changes).
  const blocks = useBlocked();
  const [revealed, setRevealed] = useState(() => new Set());
  useEffect(() => setRevealed(new Set()), [channel]);
  const emojiMap = useMemo(() => emojiLookup(emoji), [emoji]);
  const emojiById = useMemo(() => new Map(emoji.map((e) => [e.id, e])), [emoji]);
  const containerRef = useRef(null);
  // The message being edited, and where focus goes when that edit ends: back
  // to its row, or to the composer when the composer's up arrow started it.
  const [editingId, setEditingId] = useState(null);
  const editReturn = useRef('row');
  // The message whose edit history is open (P3-27).
  const [historyId, setHistoryId] = useState(null);
  const historyOf = historyId != null ? messages.find((x) => x.id === historyId) : null;

  // Edit your newest loaded message that has text (the composer's up arrow;
  // attachment-only messages are skipped). Returns whether there was one.
  function startEditLast() {
    const last = [...messages].reverse().find((m) => m.author === currentUser && m.content && !m.kind && onEdit);
    if (!last) return false;
    editReturn.current = 'composer';
    setEditingId(last.id);
    containerRef.current?.querySelector(`[data-msg-id="${last.id}"]`)?.scrollIntoView?.({ block: 'nearest' });
    return true;
  }
  // jumpTo(id): go to a message (loading the history around it if needed).
  // rowElement(id): that message's row, if it's rendered (to give focus back to).
  useImperativeHandle(ref, () => ({
    startEditLast,
    jumpTo: (id) => jumpToRef.current(id),
    rowElement: (id) => containerRef.current?.querySelector(`[data-msg-id="${id}"]`) || null,
  }));
  const jumpToRef = useRef(null);

  // Called by a row when its edit ends. Returns true if the row should take
  // focus back itself.
  function endEdit() {
    setEditingId(null);
    if (editReturn.current === 'composer') {
      editReturn.current = 'row';
      onEditDone?.();
      return false;
    }
    return true;
  }
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
  live.current = { messages, hasMore, loadingOlder, onLoadOlder, newMessages, currentUser, history };

  // Whether you were at (near) the bottom at your last scroll. When an image
  // finishes loading — a generated one arriving, or any slow picture — the
  // list grows without a scroll event; if you were at the bottom, stay there.
  const nearBottomRef = useRef(true);
  function noteScroll() {
    const el = containerRef.current;
    if (el) nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
  }
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const onLoad = (e) => {
      if (e.target?.tagName !== 'IMG' || !nearBottomRef.current || live.current.history?.hasNewer) return;
      bottomRef.current?.scrollIntoView?.({ block: 'end' });
    };
    el.addEventListener('load', onLoad, true); // load doesn't bubble: capture it
    return () => el.removeEventListener('load', onLoad, true);
  }, []);

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

  function note(text) {
    setJumpNote(text);
    timers.current.push(setTimeout(() => setJumpNote(''), 3000));
  }
  // Scroll to a loaded message and highlight it; false if it isn't loaded.
  function showMessage(id) {
    const el = containerRef.current?.querySelector(`[data-msg-id="${id}"]`);
    if (!el) return false;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.focus({ preventScroll: true });
    setFlashId(id);
    timers.current.push(setTimeout(() => setFlashId((cur) => (cur === id ? null : cur)), 2000));
    return true;
  }
  // A reply's quote was clicked: go to the original, loading the history
  // around it first if it isn't loaded.
  async function jumpTo(id) {
    if (showMessage(id)) return;
    const h = live.current.history;
    if (!h?.jumpAround) {
      note('The original message is further up in the history.');
      return;
    }
    if (!(await h.jumpAround(id))) {
      note("Couldn't load the original message.");
      return;
    }
    // Wait for the window to render, then go to it.
    for (let i = 0; i < 20 && !containerRef.current?.querySelector(`[data-msg-id="${id}"]`); i++) await nextFrame();
    if (!showMessage(id)) note("Couldn't load the original message.");
  }

  jumpToRef.current = jumpTo;

  async function jumpToPresent() {
    pendingInitialScroll.current = true; // the newest page lands at the bottom
    await live.current.history?.jumpToPresent();
  }

  // Reading older history: a sentinel at the bottom asks for newer pages.
  const bottomSentinel = useRef(null);
  const loadNewerRef = useRef(null);
  loadNewerRef.current = history?.hasNewer && !history.loadingNewer ? history.loadNewer : null;
  useEffect(() => {
    const el = containerRef.current;
    const sentinel = bottomSentinel.current;
    if (!el || !sentinel || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && loadNewerRef.current) loadNewerRef.current();
      },
      { root: el, rootMargin: '0px 0px 300px 0px' }
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, [history?.hasNewer, history?.loadingNewer]);

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
    // Reading older history: never chase the bottom (newer pages append there).
    if (live.current.history?.hasNewer) return;
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
    // A blocked person's message (P9-07b): one "Blocked message · Show" row
    // for a run of them, until shown.
    if (!m.kind && blocks.isBlocked(m.author) && !revealed.has(m.id)) {
      const prev = rows[rows.length - 1];
      if (prev && prev.kind === 'blocked') prev.ids.push(m.id);
      else rows.push({ kind: 'blocked', key: `b-${m.id}`, ids: [m.id] });
      lastAuthor = null;
      return;
    }
    // A group DM's notice ("sandy added bob", P9-06d): its own centered line.
    if (m.kind === 'system') {
      rows.push({ kind: 'system', key: m.id, m });
      lastAuthor = null;
      return;
    }
    // A reply always starts a new block, so its quote line sits under a header.
    const grouped = !m.replyTo && m.author === lastAuthor && m.timestamp - lastTs < 5 * 60 * 1000;
    rows.push({ kind: 'msg', key: m.id, m, grouped });
    lastAuthor = m.author;
    lastTs = m.timestamp;
  });

  return (
    <div
      ref={containerRef}
      onScroll={() => {
        noteScroll();
        if (divider) checkDivider();
      }}
      className="relative flex-1 overflow-y-auto"
    >
      {history?.hasNewer && (
        <div className="sticky top-0 z-30 flex items-center gap-3 bg-ink-900/95 px-4 py-1.5 text-sm text-gray-200 shadow-md ring-1 ring-ink-500/60">
          <span className="min-w-0 flex-1 truncate">You’re viewing older messages</span>
          <button type="button" onClick={jumpToPresent} className="shrink-0 font-semibold text-brand-hi hover:underline">
            Jump to present
          </button>
        </div>
      )}
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
        aria-label={label || (simple ? 'Messages' : `Messages in #${channel}`)}
        className={`flex min-h-full flex-col px-4 py-4 ${topAligned ? '' : 'justify-end'}`}
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
          <EmptyState
            as="p"
            icon={emptyIcon || undefined}
            art={emptyIcon ? undefined : emptyArt || (simple ? 'dms' : 'channel')}
            compact={!!emptyIcon}
            title={emptyHeading ?? `Welcome to #${channel}`}
            body={emptyBody ?? 'This is the start of the channel. Say hello! 👋'}
          />
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
          ) : row.kind === 'blocked' ? (
            <p key={row.key} data-msg-id={row.ids[0]} className="my-1 flex items-center gap-2 pl-14 text-xs italic text-gray-500">
              {row.ids.length === 1 ? 'Blocked message' : `${row.ids.length} blocked messages`}
              <button
                type="button"
                onClick={() => setRevealed((prev) => new Set([...prev, ...row.ids]))}
                className="rounded px-1.5 py-0.5 not-italic font-medium text-brand-hi hover:bg-ink-600"
              >
                Show
              </button>
            </p>
          ) : row.kind === 'system' ? (
            <p key={row.key} data-msg-id={row.m.id} role="note" className="my-2 text-center text-xs text-gray-500">
              {row.m.content}
              <span className="ml-2 text-gray-600">{formatTime(row.m.timestamp)}</span>
            </p>
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
              onHidePreview={onHidePreview && (row.m.author === currentUser || canModerate?.(row.m.author)) ? () => onHidePreview(row.m) : undefined}
              imagineAgain={imagineAgain}
              imagineUpscale={imagineUpscale}
              imaginePictures={imaginePictures}
              onReact={onReact}
              onReply={onReply}
              onPin={onPin}
              onCreateThread={onCreateThread}
              onOpenThread={onOpenThread}
              threadBadge={threadBadge}
              emoji={emoji}
              emojiMap={emojiMap}
              emojiById={emojiById}
              onJumpTo={jumpTo}
              flash={row.m.id === flashId}
              simple={simple}
              tabIndex={row.m.id === tabStopId ? 0 : -1}
              onFocusRow={() => setActiveId(row.m.id)}
              onNavigate={focusSibling}
              editing={row.m.id === editingId}
              onStartEdit={() => {
                editReturn.current = 'row';
                setEditingId(row.m.id);
              }}
              onEndEdit={endEdit}
              onShowHistory={loadVersions ? () => setHistoryId(row.m.id) : undefined}
              onReport={onReport && row.m.author !== currentUser && !row.m.bot ? () => onReport(row.m) : undefined}
            />
          )
        )}
        {history?.hasNewer && (
          <div className="flex justify-center py-3">
            <div ref={bottomSentinel} aria-hidden="true" />
            <button
              type="button"
              onClick={() => history.loadNewer()}
              disabled={history.loadingNewer}
              className="rounded-full bg-ink-600 px-4 py-1.5 text-sm text-gray-200 transition hover:bg-ink-500 disabled:opacity-60"
            >
              {history.loadingNewer ? 'Loading newer messages…' : 'Load newer messages'}
            </button>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      {historyOf && (
        <EditHistoryDialog
          author={historyOf.author}
          version={historyOf.editedAt}
          load={() => loadVersions(historyOf)}
          render={(text) => renderMarkdown(text, { me: currentUser, mentions: !simple, emoji: emojiMap })}
          onClose={() => setHistoryId(null)}
        />
      )}
    </div>
  );
});

export default MessageList;

function MessageRow({ m, grouped, mine, currentUser, onEdit, onDelete, canDelete, onHidePreview, imagineAgain, imagineUpscale, imaginePictures, onReact, onReply, onPin, onCreateThread, onOpenThread, threadBadge, emoji, emojiMap, emojiById, onJumpTo, flash, simple, tabIndex, onFocusRow, onNavigate, editing, onStartEdit, onEndEdit, onShowHistory, onReport }) {
  const blocks = useBlocked(); // P9-07b: the Block item and reply quotes
  const [draft, setDraft] = useState(m.content || '');
  const editRef = useRef(null);
  // Entering edit mode (from this row or the composer's up arrow): start from
  // the message's text, with the caret at the end.
  useEffect(() => {
    if (!editing) return;
    const text = m.content || '';
    setDraft(text);
    requestAnimationFrame(() => {
      const el = editRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(text.length, text.length);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);
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
    onStartEdit();
  }

  function finishEdit() {
    if (onEndEdit()) focusRow();
  }

  function saveEdit() {
    const next = draft.trim();
    if (next && next !== m.content) onEdit(m.id, next);
    finishEdit();
  }

  // No "are you sure?": the message hides with an Undo toast instead (see
  // useUndoDelete). Focus moves to a neighbouring message so it isn't lost.
  function confirmDelete() {
    setPopup(null);
    const row = rowRef.current;
    if (row && row.contains(document.activeElement)) onNavigate(row, row.nextElementSibling?.matches('[data-msg-row]') ? 1 : -1);
    onDelete(m.id);
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
    onPin && {
      id: 'pin', label: m.pinned ? 'Unpin message' : 'Pin message', icon: 'pin',
      onSelect: () => {
        onPin(m.id, !m.pinned);
        closePopup();
      },
    },
    // A message has at most one thread: start it, or open the one it has.
    onCreateThread && !m.thread && {
      id: 'thread', label: 'Create thread', icon: 'thread',
      onSelect: () => {
        closePopup();
        onCreateThread(m);
      },
    },
    onOpenThread && m.thread && {
      id: 'thread', label: 'Open thread', icon: 'thread',
      onSelect: () => {
        closePopup();
        onOpenThread(m.thread, m, rowRef.current);
      },
    },
    // P9-07b: block the author (just for me), beside Report.
    !mine && !m.bot && !m.kind && m.author && blocks.requestBlock && !blocks.isBlocked(m.author) && {
      id: 'block', label: `Block ${m.author}…`, icon: 'ban',
      onSelect: () => {
        closePopup();
        blocks.requestBlock(m.author);
      },
    },
    // Others' messages (not the bot's): flag them for the moderators (P9-01).
    onReport && {
      id: 'report', label: 'Report…', icon: 'flag',
      onSelect: () => {
        closePopup();
        onReport();
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
  // Events from dialogs this row opened (the image viewer, menus) reach it
  // through React's portals though they happen elsewhere on the page; only
  // the row's own area counts (P3-30: right-clicking the viewer's image opened
  // this message's menu behind it instead of the browser's own menu).
  const fromRow = (e) => !!rowRef.current?.contains(e.target);
  function onPointerDown(e) {
    if (!fromRow(e)) return;
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
    if (editing || !actions.length || !fromRow(e)) return;
    e.preventDefault();
    openPopup('menu', lastPointer.current === 'touch');
  }

  const hasAttachment = m.attachments?.length || m.attachment;
  const replyLabel = m.replyTo ? (m.replyTo.deleted ? 'replying to a deleted message, ' : `replying to ${m.replyTo.author}, `) : '';
  const threadLabel = m.thread ? `, has a thread: ${m.thread.name}` : '';
  const label = `${m.author || 'Unknown'}, ${formatTime(m.timestamp)}, ${replyLabel}${m.content || (hasAttachment ? 'attachment' : '')}${threadLabel}`;

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
      className={`group relative flex gap-3 px-2 py-0.5 outline-hidden transition-colors hover:bg-ink-600/40 focus-visible:bg-ink-600/40 focus-visible:ring-1 focus-visible:ring-brand-hi [-webkit-touch-callout:none] [@media(hover:none)]:select-none ${
        grouped ? '' : 'mt-3'
      } ${mentionsMe ? 'border-l-2 border-pink bg-pink/10' : ''} ${flash ? 'bg-brand/20! ring-1 ring-brand-hi/60' : ''}`}
    >
      <div className="relative w-10 shrink-0">
        {grouped ? (
          // Out of the layout and on one line, so showing it on hover never
          // changes the row's height.
          <span className="absolute right-0 top-1 hidden whitespace-nowrap text-[11px] leading-4 text-gray-400 group-hover:block group-focus-visible:block coarse:block">
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
              <span className="truncate">{blocks.isBlocked(m.replyTo.author) ? 'Blocked message' : m.replyTo.snippet}</span>
            </button>
          )
        )}
        {!grouped && (
          <div className="flex items-baseline gap-2">
            <RoleName name={m.author} className="font-semibold text-gray-100">{m.author || 'Unknown'}</RoleName>
            {m.bot && (
              <span title="Bot account" className="rounded-sm bg-brand/20 px-1 py-px text-[10px] font-semibold leading-tight text-brand-hi">
                BOT
              </span>
            )}
            <span className="text-xs text-gray-500">{formatTime(m.timestamp)}</span>
          </div>
        )}

        {editing ? (
          <div className="mt-1">
            <textarea
              ref={editRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onEditKeyDown}
              rows={1}
              aria-label="Edit message"
              className="w-full resize-none rounded-lg bg-ink-800 px-3 py-2 text-gray-100 outline-hidden ring-1 ring-ink-500 focus:ring-brand-hi"
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
            {m.pinned && (
              <div className="flex items-center gap-1 text-[11px] font-medium text-gray-500">
                <Icon name="pin" size={11} /> Pinned
              </div>
            )}
            {m.content && (
              <div className="whitespace-pre-wrap wrap-break-word text-gray-200">
                {renderMarkdown(m.content, { me: currentUser, mentions: !simple, emoji: emojiMap })}
                {m.editedAt &&
                  (onShowHistory ? (
                    // P3-27: opens the earlier versions.
                    <button
                      type="button"
                      onClick={onShowHistory}
                      title={`Edited ${formatDay(m.editedAt)} at ${formatTime(m.editedAt)} · show edit history`}
                      className="ml-1 text-[10px] text-gray-500 hover:text-gray-300 hover:underline"
                    >
                      (edited)
                    </button>
                  ) : (
                    <span className="ml-1 text-[10px] text-gray-500">(edited)</span>
                  ))}
              </div>
            )}
            {hasAttachment && (
              <Album
                items={m.attachments?.length ? m.attachments : [m.attachment]}
                spoiler={m.spoiler}
              />
            )}
            {m.embeds?.map((e) => <Embed key={e.url} embed={e} onHide={onHidePreview} />)}
            {imagineAgain && imagineResultKind(m) && <ImagineAgain m={m} kind={imagineResultKind(m)} run={imagineAgain} canUpscale={imagineUpscale} pictures={imaginePictures || undefined} />}
            {m.thread && onOpenThread && <ThreadSummary thread={m.thread} badge={threadBadge?.(m.thread.channel)} onOpen={(el) => onOpenThread(m.thread, m, el)} />}
            {reactions.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1 coarse:gap-2">
                {reactions.map((r) => {
                  const mineReacted = r.users?.includes(currentUser);
                  // A custom emoji reaction shows its image, or :name: if it's gone.
                  const token = parseEmojiToken(r.emoji);
                  const image = token && emojiById?.get(token.id);
                  const shown = token ? `:${token.name}:` : r.emoji;
                  return (
                    <button
                      key={r.emoji}
                      onClick={() => onReact(m.id, r.emoji)}
                      title={(r.users || []).join(', ')}
                      aria-label={`${shown} ${r.count}${mineReacted ? ', you reacted' : ''}`}
                      aria-pressed={!!mineReacted}
                      className={`tap-reaction flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ring-1 transition ${
                        mineReacted
                          ? 'bg-brand/25 text-fg ring-brand-hi'
                          : 'bg-ink-600/60 text-gray-200 ring-ink-500/60 hover:ring-brand-hi'
                      }`}
                    >
                      <span>{image ? <img src={image.url} alt={shown} className="h-[18px] w-[18px] object-contain" /> : shown}</span>
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
      {popup === 'react' && <ReactionPicker sheet={sheet} above={above} custom={emoji} onPick={pickReaction} onClose={closePopup} />}
    </div>
  );
}
