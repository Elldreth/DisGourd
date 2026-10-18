import { useEffect, useRef, useState } from 'react';
import MessageList from './MessageList.jsx';
import PinsPanel from './PinsPanel.jsx';
import ThreadsList from './ThreadsList.jsx';
import CreateThreadDialog from './CreateThreadDialog.jsx';
import Composer from './Composer.jsx';
import TypingIndicator from './TypingIndicator.jsx';
import Icon from './Icon.jsx';
import IconButton from './IconButton.jsx';
import EmptyState from './EmptyState.jsx';
import DropOverlay from './DropOverlay.jsx';
import { useFileDrop } from '../useFileDrop.js';
import { renderMarkdown } from '../markdown.jsx';

export default function ChatPanel({
  space,
  channel,
  status,
  canPost = true,
  messages,
  currentUser,
  typingUsers = [],
  memberNames = [],
  onSend,
  onEdit,
  onDelete,
  canModerate,
  onReact,
  hasMore,
  loadingOlder,
  onLoadOlder,
  history,
  newMessages,
  onTyping,
  onOpenSearch,
  onOpenNav,
  onOpenMembers,
  membersOpen = false,
  canPin = false,
  onSetPinned,
  pinsVersion = 0,
  // Threads: onOpenThread(thread, { root, opener }) opens one in the side
  // panel; threadsVersion changes when this channel's threads change.
  onOpenThread,
  threadsVersion = 0,
  threadBadge, // (channel) => { unread, mentions } for a thread's summary or row
  threadsUnread = 0, // how many of this channel's threads have something unread
  emoji = [], // the server's custom emoji [{ id, name, url }]
  topic = null, // the channel's topic (P3-20a), or null
  imagine = null, // /imagine for this server (imagineState), or null
}) {
  const [pinsOpen, setPinsOpen] = useState(false);
  // The whole topic, shown under the header; closes on Esc or a channel switch.
  const [topicOpen, setTopicOpen] = useState(false);
  useEffect(() => setTopicOpen(false), [space, channel]);
  useEffect(() => {
    if (!topicOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setTopicOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [topicOpen]);
  const [threadsOpen, setThreadsOpen] = useState(false);
  const [threadFrom, setThreadFrom] = useState(null); // the message a new thread starts from
  // The phone-only More menu (Threads, Pins). Opening it focuses its first
  // item; Esc or picking an item closes it and puts focus back on the button.
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef(null);
  const firstMoreItem = useRef(null);
  useEffect(() => {
    if (moreOpen) firstMoreItem.current?.focus();
  }, [moreOpen]);
  const closeMore = (refocus = true) => {
    setMoreOpen(false);
    if (refocus) moreRef.current?.focus();
  };
  const onMoreKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeMore();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const items = [...e.currentTarget.querySelectorAll('[role=menuitem]')];
      const i = items.indexOf(document.activeElement);
      items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
    }
  };
  useEffect(() => {
    setPinsOpen(false);
    setThreadsOpen(false);
    setThreadFrom(null);
    setMoreOpen(false);
  }, [space, channel]);
  // The message being replied to ({ id, author }), shown above the composer.
  const [replyingTo, setReplyingTo] = useState(null);
  useEffect(() => setReplyingTo(null), [space, channel]);
  // Files dropped anywhere on the panel go to the composer.
  const composerRef = useRef(null);
  const listRef = useRef(null);
  const drop = useFileDrop({ enabled: !!channel && canPost, onFiles: (files) => composerRef.current?.addFiles(files) });

  if (!space) {
    return (
      <Empty
        onOpenNav={onOpenNav}
        art="server"
        title="No server selected"
        body="Pick a server on the left, or press + to create one and invite your friends."
      />
    );
  }
  if (!channel) {
    return (
      <Empty
        onOpenNav={onOpenNav}
        art="channel"
        title={`Welcome to ${space}`}
        body="Create a text channel with the + next to “Text channels” to start talking."
      />
    );
  }

  const degraded = status === 'reconnecting' || status === 'closed' || status === 'connecting';

  return (
    <main className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-ink-700" {...drop.dropProps}>
      {drop.dragging && <DropOverlay target={`#${channel}`} />}
      <header className="flex h-12 items-center gap-2 border-b border-ink-900/60 px-3 shadow-xs shadow-black/20 md:px-4">
        <IconButton
          icon="menu"
          size={20}
          label="Channels"
          onClick={onOpenNav}
          className="tap -ml-1 rounded-lg p-1.5 text-gray-300 transition hover:bg-ink-600 hover:text-fg md:hidden"
        />
        <Icon name="hash" size={20} className="text-gray-500" />
        <h2 className="shrink-0 font-bold">{channel}</h2>
        {/* The topic (P3-20a): one truncated line; click or Enter shows it all. */}
        {topic ? (
          <button
            type="button"
            onClick={() => setTopicOpen((v) => !v)}
            aria-expanded={topicOpen}
            aria-controls="channel-topic-full"
            aria-label={`Topic: ${topic.split('\n')[0]}`}
            title={topicOpen ? 'Hide the topic' : 'Show the whole topic'}
            className="ml-1 min-w-0 flex-1 truncate border-l border-ink-500/60 pl-3 text-left text-sm text-gray-400 hover:text-gray-200 max-[399px]:hidden"
          >
            {topic.split('\n')[0]}
          </button>
        ) : (
          <div className="flex-1" />
        )}
        {onOpenMembers && (
          <button
            onClick={onOpenMembers}
            title="Members"
            aria-label="Members"
            aria-expanded={membersOpen}
            className="tap rounded-lg p-1.5 text-gray-400 transition hover:bg-ink-600 hover:text-fg lg:hidden"
          >
            <Icon name="users" size={18} />
          </button>
        )}
        {/* Phones: Threads and Pins fold under one More menu so the header
            buttons have room at 44px. md and up keeps the separate buttons. */}
        <span className="relative md:hidden">
          <IconButton
            ref={moreRef}
            icon="more"
            size={18}
            label={threadsUnread ? `More (${threadsUnread} unread)` : 'More'}
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((v) => !v)}
            className="tap rounded-lg p-1.5 text-gray-400 transition hover:bg-ink-600 hover:text-fg md:hidden"
          />
          {threadsUnread > 0 && (
            <span aria-hidden="true" className="pointer-events-none absolute right-1 top-1 h-2 w-2 rounded-full bg-brand" />
          )}
          {moreOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMoreOpen(false)} />
              <div
                role="menu"
                aria-label="More"
                onKeyDown={onMoreKey}
                className="anim-pop absolute right-0 top-full z-20 mt-1 w-56 rounded-lg bg-ink-900 p-1 shadow-xl ring-1 ring-ink-500/60"
              >
                {onOpenThread && (
                  <button
                    type="button"
                    role="menuitem"
                    ref={firstMoreItem}
                    aria-label={threadsUnread ? `Threads (${threadsUnread} unread)` : undefined}
                    onClick={() => {
                      closeMore(false);
                      setThreadsOpen(true);
                    }}
                    className="tap-row flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition hover:bg-ink-600 focus-visible:bg-ink-600"
                  >
                    <Icon name="thread" size={16} className="text-brand-hi" />
                    <span className="flex-1">Threads</span>
                    {threadsUnread > 0 && (
                      <span className="rounded-full bg-brand px-1.5 text-xs font-bold text-ink-900">
                        {threadsUnread}
                        <span className="sr-only"> unread</span>
                      </span>
                    )}
                  </button>
                )}
                <button
                  type="button"
                  role="menuitem"
                  ref={onOpenThread ? undefined : firstMoreItem}
                  onClick={() => {
                    closeMore(false);
                    setPinsOpen(true);
                  }}
                  className="tap-row flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition hover:bg-ink-600 focus-visible:bg-ink-600"
                >
                  <Icon name="pin" size={16} className="text-brand-hi" />
                  Pinned messages
                </button>
              </div>
            </>
          )}
        </span>
        {onOpenThread && (
          <span className="relative hidden md:inline-flex">
            <IconButton
              icon="thread"
              size={18}
              label={threadsUnread ? `Threads (${threadsUnread} unread)` : 'Threads'}
              aria-haspopup="dialog"
              aria-expanded={threadsOpen}
              onClick={() => setThreadsOpen(true)}
              className="tap hidden items-center justify-center rounded-lg p-1.5 text-gray-400 transition hover:bg-ink-600 hover:text-fg md:inline-flex"
            />
            {threadsUnread > 0 && (
              <span aria-hidden="true" className="pointer-events-none absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-brand px-1 text-center text-[10px] font-bold leading-4 text-ink-900">
                {threadsUnread}
              </span>
            )}
          </span>
        )}
        <IconButton
          icon="pin"
          size={18}
          label="Pinned messages"
          aria-haspopup="dialog"
          aria-expanded={pinsOpen}
          onClick={() => setPinsOpen(true)}
          className="tap hidden items-center justify-center rounded-lg p-1.5 text-gray-400 transition hover:bg-ink-600 hover:text-fg md:inline-flex"
        />
        <IconButton
          icon="search"
          size={18}
          label="Search messages"
          onClick={onOpenSearch}
          className="tap rounded-lg p-1.5 text-gray-400 transition hover:bg-ink-600 hover:text-fg"
        />
      </header>
      {topic && topicOpen && (
        <div id="channel-topic-full" className="prose-chat max-h-48 overflow-y-auto whitespace-pre-wrap border-b border-ink-900/60 bg-ink-800/60 px-4 py-2 text-sm text-gray-300">
          {renderMarkdown(topic, {})}
        </div>
      )}

      {degraded && (
        <div className="anim-slide-down bg-idle/20 px-4 py-1 text-center text-sm text-idle">
          {status === 'closed' ? 'Disconnected — retrying…' : 'Reconnecting…'} Messages you send will
          be delivered once you’re back online.
        </div>
      )}

      <MessageList
        ref={listRef}
        emptyBody={topic || undefined}
        onPin={canPin && onSetPinned ? onSetPinned : undefined}
        messages={messages}
        channel={channel}
        currentUser={currentUser}
        onEdit={onEdit}
        onDelete={onDelete}
        canModerate={canModerate}
        onReact={onReact}
        onReply={canPost ? (m) => setReplyingTo({ id: m.id, author: m.author }) : null}
        onCreateThread={onOpenThread && canPost ? (m) => setThreadFrom(m) : undefined}
        onOpenThread={onOpenThread ? (t, m, opener) => onOpenThread(t, { root: m, opener }) : undefined}
        threadBadge={threadBadge}
        emoji={emoji}
        hasMore={hasMore}
        loadingOlder={loadingOlder}
        onLoadOlder={onLoadOlder}
        history={history}
        newMessages={newMessages}
        onEditDone={() => composerRef.current?.focus()}
      />
      <TypingIndicator names={typingUsers} />
      {canPost ? (
        // Always enabled: sends during a blip are queued and flushed on reconnect.
        <Composer
          ref={composerRef}
          imagine={imagine}
          channel={channel}
          onEditLast={() => listRef.current?.startEditLast() ?? false}
          disabled={false}
          onSend={(content, attachments, spoiler) => {
            onSend(content, attachments, spoiler, replyingTo ? replyingTo.id : undefined);
            setReplyingTo(null);
          }}
          onTyping={onTyping}
          mentionCandidates={memberNames}
          customEmoji={emoji}
          replyingTo={replyingTo}
          onCancelReply={() => setReplyingTo(null)}
        />
      ) : (
        <div className="mx-4 mb-5 mt-1 flex items-center justify-center gap-2 rounded-xl bg-ink-800 px-4 py-3 text-center text-sm text-gray-400 ring-1 ring-ink-500/40">
          <Icon name="shield" size={15} className="shrink-0" /> You don’t have permission to post in this channel.
        </div>
      )}
      {threadsOpen && (
        <ThreadsList
          space={space}
          channel={channel}
          version={threadsVersion}
          badge={threadBadge}
          onOpen={(t) => onOpenThread(t, {})}
          onClose={() => setThreadsOpen(false)}
        />
      )}
      {threadFrom && (
        <CreateThreadDialog
          space={space}
          channel={channel}
          message={threadFrom}
          onCreated={(t) => {
            const root = threadFrom;
            setThreadFrom(null);
            onOpenThread(t, { root, opener: listRef.current?.rowElement?.(root.id) });
          }}
          onClose={() => setThreadFrom(null)}
        />
      )}
      {pinsOpen && (
        <PinsPanel
          space={space}
          channel={channel}
          version={pinsVersion}
          canPin={canPin}
          onUnpin={(id) => onSetPinned?.(id, false)}
          onJump={(id) => listRef.current?.jumpTo(id)}
          onClose={() => setPinsOpen(false)}
        />
      )}
    </main>
  );
}

function Empty({ art, title, body, onOpenNav }) {
  return (
    <main className="anim-fade relative flex min-w-0 flex-1 flex-col items-center justify-center bg-ink-700 p-8 text-center">
      {onOpenNav && (
        <IconButton
          icon="menu"
          size={22}
          label="Channels"
          onClick={onOpenNav}
          className="absolute left-2 top-2 rounded-lg p-2 text-gray-300 transition hover:bg-ink-600 hover:text-fg md:hidden"
        />
      )}
      <EmptyState art={art} as="h2" title={title} body={body} />
    </main>
  );
}
