import * as api from '../api.js';
import { useEffect, useRef, useState } from 'react';
import Avatar from './Avatar.jsx';
import MessageList from './MessageList.jsx';
import Composer from './Composer.jsx';
import TypingIndicator from './TypingIndicator.jsx';
import Icon from './Icon.jsx';
import IconButton from './IconButton.jsx';
import DropOverlay from './DropOverlay.jsx';
import EmptyState from './EmptyState.jsx';
import { useFileDrop } from '../useFileDrop.js';

// The conversation view in Direct Messages mode.
export default function DmPanel({ conversationKey = '', username, messages, currentUser, newMessages = null, typing = [], onSend, onEdit, onDelete, hasMore, loadingOlder, onLoadOlder, history, onTyping, onOpenSearch, onOpenNav, onNewMessage }) {
  // The message being replied to ({ id, author }), cleared on send, Esc or switching conversation.
  const [replyingTo, setReplyingTo] = useState(null);
  useEffect(() => setReplyingTo(null), [conversationKey]);
  // Files dropped anywhere on the conversation go to the composer.
  const composerRef = useRef(null);
  const listRef = useRef(null);
  const drop = useFileDrop({ enabled: !!username, onFiles: (files) => composerRef.current?.addFiles(files) });

  if (!username) {
    return (
      <main className="relative flex min-w-0 flex-1 flex-col items-center justify-center bg-ink-700 p-8 text-center">
        {onOpenNav && (
          <IconButton
            icon="menu"
            size={22}
            label="Conversations"
            onClick={onOpenNav}
            className="absolute left-2 top-2 rounded-lg p-2 text-gray-300 transition hover:bg-ink-600 hover:text-fg md:hidden"
          />
        )}
        <EmptyState
          art="dms"
          as="h2"
          title="Your messages"
          body={onNewMessage ? 'Pick a conversation, or start one with anyone you share a server with.' : 'Pick a conversation, or open a member in one of your servers to start a new one.'}
          action={onNewMessage ? { label: 'New message', onClick: onNewMessage } : undefined}
        />
      </main>
    );
  }

  return (
    <main className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-ink-700" {...drop.dropProps}>
      {drop.dragging && <DropOverlay target={`@${username}`} />}
      <header className="flex h-12 items-center gap-2 border-b border-ink-900/60 px-3 shadow-xs shadow-black/20 md:px-4">
        <IconButton
          icon="menu"
          size={20}
          label="Conversations"
          onClick={onOpenNav}
          className="-ml-1 rounded-lg p-1.5 text-gray-300 transition hover:bg-ink-600 hover:text-fg md:hidden"
        />
        <Avatar name={username} size={24} />
        <h2 className="font-bold">{username}</h2>
        <div className="flex-1" />
        <IconButton
          icon="search"
          size={18}
          label="Search messages"
          onClick={onOpenSearch}
          className="rounded-lg p-1.5 text-gray-400 transition hover:bg-ink-600 hover:text-fg"
        />
      </header>

      <MessageList
        ref={listRef}
        messages={messages}
        currentUser={currentUser}
        onEdit={onEdit}
        onDelete={onDelete}
        hasMore={hasMore}
        loadingOlder={loadingOlder}
        onLoadOlder={onLoadOlder}
        history={history}
        newMessages={newMessages}
        onHidePreview={(m) => api.hideDmPreview(conversationKey, m.id).catch(() => {})}
        loadVersions={(m) => api.getDmVersions(conversationKey, m.id)}
        onReply={(m) => setReplyingTo({ id: m.id, author: m.author })}
        simple
        emptyHeading={`This is the beginning of your conversation with ${username}`}
        emptyBody="Say hi! 👋"
        onEditDone={() => composerRef.current?.focus()}
      />
      <TypingIndicator names={typing} />
      <Composer
        ref={composerRef}
        onEditLast={() => listRef.current?.startEditLast() ?? false}
        channel={conversationKey}
        disabled={false}
        onSend={(content, attachments, spoiler) => {
          onSend(content, attachments, spoiler, replyingTo ? replyingTo.id : undefined);
          setReplyingTo(null);
        }}
        replyingTo={replyingTo}
        onCancelReply={() => setReplyingTo(null)}
        onTyping={onTyping}
        placeholder={`Message @${username}`}
      />
    </main>
  );
}
