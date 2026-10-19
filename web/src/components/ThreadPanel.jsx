import { useEffect, useRef, useState } from 'react';
import * as api from '../api.js';
import MessageList from './MessageList.jsx';
import Composer from './Composer.jsx';
import TypingIndicator from './TypingIndicator.jsx';
import TimedOutNotice from './TimedOutNotice.jsx';
import RoleName from './RoleName.jsx';
import Avatar from './Avatar.jsx';
import Icon from './Icon.jsx';
import IconButton from './IconButton.jsx';
import { renderMarkdown } from '../markdown.jsx';
import { formatDay, formatTime } from '../util.js';
import { emojiLookup } from '../emoji.js';

// An open thread: the message it started from, its replies and a composer.
// It sits to the right of the channel on wide screens and fills the screen on
// phones. Esc closes it (App gives focus back to the summary it came from).
//   thread: { channel: '~tN', name, parentChannel, rootMessageId, root?, archived? } —
//     `root` is the root message when it's at hand; otherwise it's fetched.
//   An archived thread (quiet for a while) stays readable; a reply reopens it,
//   and `onSetArchived(archived)` (moderators) archives or reopens by hand.
// The first picture in a message (P3-36b: /imagine can start from it).
const firstPicture = (m) => [...(m.attachments || []), m.attachment].find((u) => u && /\.(png|jpe?g|webp)$/i.test(u.split('?')[0])) || null;

export default function ThreadPanel({
  space,
  thread,
  status,
  canPost = true,
  timedOut = null, // P3-26c: { until, reason } while I'm timed out here
  messages,
  currentUser,
  typingUsers = [],
  memberNames = [],
  onSend,
  onEdit,
  onDelete,
  canModerate,
  canPin = false,
  onSetPinned,
  onReact,
  hasMore,
  loadingOlder,
  onLoadOlder,
  history,
  onTyping,
  onClose,
  followed = false, // you follow this thread (it counts as unread and notifies)
  onToggleFollow, // (follow: boolean)
  onSetArchived, // (archived: boolean), only when you may
  emoji = [], // the server's custom emoji [{ id, name, url }]
  imagine = null, // /imagine for this server (imagineState), or null
}) {
  const [root, setRoot] = useState(thread.root || null); // null while loading; false = deleted
  const [replyingTo, setReplyingTo] = useState(null);
  const composerRef = useRef(null);
  const listRef = useRef(null);
  const panelRef = useRef(null);

  // The root message isn't always at hand (a thread opened from the list or
  // a search result): find it in the parent's history.
  useEffect(() => {
    setReplyingTo(null);
    if (thread.root) {
      setRoot(thread.root);
      return undefined;
    }
    let live = true;
    setRoot(null);
    api
      .getMessages(space, thread.parentChannel, { around: thread.rootMessageId })
      .then((rows) => live && setRoot(rows.find((m) => m.id === thread.rootMessageId) || false))
      .catch(() => live && setRoot(false));
    return () => {
      live = false;
    };
  }, [space, thread]);

  // Focus lands in the composer, where you can type a reply straight away.
  useEffect(() => {
    composerRef.current?.focus();
  }, [thread.channel]);

  function onKeyDown(e) {
    if (e.key === 'Escape' && !e.defaultPrevented) {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  }

  const degraded = status === 'reconnecting' || status === 'closed' || status === 'connecting';

  return (
    <aside
      ref={panelRef}
      role="complementary"
      aria-label={`Thread: ${thread.name}`}
      onKeyDown={onKeyDown}
      className="fixed inset-0 z-40 flex min-h-0 flex-col bg-ink-700 lg:static lg:z-auto lg:w-96 lg:shrink-0 lg:border-l lg:border-ink-900/60"
    >
      <header className="flex h-12 items-center gap-2 border-b border-ink-900/60 px-3 shadow-xs shadow-black/20">
        {/* Phones: the panel fills the screen, so a back button sits where the
            thumb is; from lg up it is a side column and the × is enough. */}
        <IconButton
          icon="chevronLeft"
          size={20}
          label={`Back to #${thread.parentChannel}`}
          onClick={onClose}
          className="tap -ml-1 rounded-lg p-1.5 text-gray-300 transition hover:bg-ink-600 hover:text-fg lg:hidden"
        />
        <Icon name="thread" size={18} className="shrink-0 text-brand-hi" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-bold leading-tight">{thread.name}</h2>
          <p className="truncate text-xs leading-tight text-gray-500">#{thread.parentChannel}</p>
        </div>
        {onSetArchived && (
          <button
            type="button"
            onClick={() => onSetArchived(!thread.archived)}
            aria-label={thread.archived ? 'Reopen thread' : 'Archive thread'}
            title={thread.archived ? 'Put this thread back in the active list' : 'Move this thread to the archived list (a reply brings it back)'}
            className="tap-chip shrink-0 rounded-md px-2 py-1 text-xs text-gray-400 ring-1 ring-ink-500/60 transition hover:text-fg"
          >
            {thread.archived ? 'Reopen' : 'Archive'}
          </button>
        )}
        {onToggleFollow && (
          <button
            type="button"
            onClick={() => onToggleFollow(!followed)}
            aria-pressed={followed}
            aria-label={followed ? 'Unfollow thread' : 'Follow thread'}
            title={followed ? 'Stop getting unread badges and notifications for this thread' : 'Get unread badges and notifications for this thread'}
            className={`tap-chip shrink-0 rounded-md px-2 py-1 text-xs ring-1 transition ${
              followed ? 'bg-brand/20 text-fg ring-brand-hi' : 'text-gray-400 ring-ink-500/60 hover:text-fg'
            }`}
          >
            {followed ? 'Following' : 'Follow'}
          </button>
        )}
        <IconButton
          icon="x"
          size={18}
          label="Close thread"
          onClick={onClose}
          className="tap rounded-lg p-1.5 text-gray-400 transition hover:bg-ink-600 hover:text-fg"
        />
      </header>

      {degraded && (
        <div className="bg-idle/20 px-4 py-1 text-center text-xs text-idle">Reconnecting… replies you send will go once you’re back online.</div>
      )}
      {thread.archived && (
        <div role="status" className="flex items-center justify-center gap-2 bg-ink-800/80 px-4 py-1 text-center text-xs text-gray-400">
          <Icon name="thread" size={12} className="shrink-0" /> This thread is archived. {canPost ? 'A reply reopens it.' : ''}
        </div>
      )}

      <RootMessage root={root} currentUser={currentUser} emoji={emoji} />

      <MessageList
        ref={listRef}
        onHidePreview={(m) => api.hideChannelPreview(space, thread.channel, m.id).catch(() => {})}
        imagineAgain={imagine?.available ? imagine.run : null}
        imagineUpscale={!!imagine?.canUpscale}
        imagineVary={!!imagine?.canVary}
        label={`Replies in thread ${thread.name}`}
        emoji={emoji}
        channel={thread.channel}
        messages={messages}
        currentUser={currentUser}
        onEdit={onEdit}
        onDelete={onDelete}
        canModerate={canModerate}
        onReact={onReact}
        onPin={canPin && onSetPinned ? onSetPinned : undefined}
        onReply={canPost ? (m) => setReplyingTo({ id: m.id, author: m.author, picture: firstPicture(m) }) : null}
        hasMore={hasMore}
        loadingOlder={loadingOlder}
        onLoadOlder={onLoadOlder}
        history={history}
        emptyHeading={messages.length ? 'The start of the thread' : 'No replies yet'}
        emptyBody={messages.length ? '' : 'Be the first to reply in this thread.'}
        emptyIcon="thread"
        topAligned
        onEditDone={() => composerRef.current?.focus()}
      />
      <TypingIndicator names={typingUsers} />
      {canPost ? (
        <Composer
          ref={composerRef}
          imagine={imagine}
          channel={thread.channel}
          placeholder={`Reply in ${thread.name}`}
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
      ) : timedOut ? (
        <TimedOutNotice timeout={timedOut} />
      ) : (
        <div className="mx-4 mb-5 mt-1 flex items-center justify-center gap-2 rounded-xl bg-ink-800 px-4 py-3 text-center text-sm text-gray-400 ring-1 ring-ink-500/40">
          <Icon name="shield" size={15} className="shrink-0" /> You don’t have permission to post in this channel.
        </div>
      )}
    </aside>
  );
}

// The message the thread started from, quoted at the top.
function RootMessage({ root, currentUser, emoji }) {
  if (root === null) return <div className="border-b border-ink-900/60 px-4 py-3 text-xs text-gray-500">Loading the original message…</div>;
  if (root === false) {
    return (
      <div className="flex items-center gap-2 border-b border-ink-900/60 px-4 py-3 text-xs italic text-gray-500">
        <Icon name="reply" size={12} className="shrink-0" /> Original message was deleted
      </div>
    );
  }
  const hasAttachment = root.attachments?.length || root.attachment;
  return (
    <div className="flex gap-3 border-b border-ink-900/60 bg-ink-800/40 px-3 py-3" aria-label="Original message">
      <Avatar name={root.author || '?'} size={32} src={root.authorAvatar} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <RoleName name={root.author} className="text-sm font-semibold text-gray-100">{root.author || 'Unknown'}</RoleName>
          <span className="text-xs text-gray-500">{`Started by ${root.author || 'unknown'} · ${formatDay(root.timestamp)} ${formatTime(root.timestamp)}`}</span>
        </div>
        <div className="prose-chat mt-0.5 max-h-40 overflow-y-auto text-sm text-gray-200">
          {root.content ? renderMarkdown(root.content, { me: currentUser, mentions: true, emoji: emojiLookup(emoji) }) : hasAttachment ? <em className="text-gray-400">Attachment</em> : null}
        </div>
      </div>
    </div>
  );
}
