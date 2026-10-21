import * as api from '../api.js';
import { useEffect, useRef, useState } from 'react';
import Avatar from './Avatar.jsx';
import GroupAvatar from './GroupAvatar.jsx';
import MessageList from './MessageList.jsx';
import Composer from './Composer.jsx';
import TypingIndicator from './TypingIndicator.jsx';
import Icon from './Icon.jsx';
import IconButton from './IconButton.jsx';
import DropOverlay from './DropOverlay.jsx';
import EmptyState from './EmptyState.jsx';
import { useFileDrop } from '../useFileDrop.js';
import { useBlocked } from '../state/useBlocks.js';

// The conversation view in Direct Messages mode. `conversation` (P9-06d) is
// the open one ({ kind, members, … }); `title` what it's called (a group's
// name or members, else the other person). A pair's header offers Add people
// (`onAddPeople`, a new group); a group's, Members (`onShowMembers`).
export default function DmPanel({ conversationKey = '', conversation = null, title = '', myId = null, onAddPeople, onShowMembers, username, messages, currentUser, newMessages = null, typing = [], onSend, onEdit, onDelete, hasMore, loadingOlder, onLoadOlder, history, onTyping, onOpenSearch, onOpenNav, onNewMessage }) {
  // The message being replied to ({ id, author }), cleared on send, Esc or switching conversation.
  const [replyingTo, setReplyingTo] = useState(null);
  useEffect(() => setReplyingTo(null), [conversationKey]);
  // Files dropped anywhere on the conversation go to the composer.
  const composerRef = useRef(null);
  const listRef = useRef(null);
  const group = conversation?.kind === 'group';
  const name = group ? title : username;
  // P9-07b: a 1-to-1 where I've blocked them, or (the server says) they've blocked me.
  const blocks = useBlocked();
  const iBlocked = !group && blocks.isBlocked(username);
  const blocked = !group && (iBlocked || !!conversation?.blocked);
  const drop = useFileDrop({ enabled: !!name, onFiles: (files) => composerRef.current?.addFiles(files) });

  if (!name) {
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
      {drop.dragging && <DropOverlay target={group ? name : `@${username}`} />}
      <header className="flex h-12 items-center gap-2 border-b border-ink-900/60 px-3 shadow-xs shadow-black/20 md:px-4">
        <IconButton
          icon="menu"
          size={20}
          label="Conversations"
          onClick={onOpenNav}
          className="-ml-1 rounded-lg p-1.5 text-gray-300 transition hover:bg-ink-600 hover:text-fg md:hidden"
        />
        {group ? (
          <GroupAvatar members={(conversation.members || []).filter((m) => m.id !== myId)} size={24} />
        ) : (
          <Avatar name={username} size={24} />
        )}
        <h2 className="min-w-0 truncate font-bold">{name}</h2>
        {group && <span className="shrink-0 text-xs text-gray-500">{conversation.members?.length || 0} members</span>}
        <div className="flex-1" />
        {group && onShowMembers && (
          <IconButton
            icon="users"
            size={18}
            label="Members"
            title="Members and group settings"
            onClick={onShowMembers}
            className="rounded-lg p-1.5 text-gray-400 transition hover:bg-ink-600 hover:text-fg"
          />
        )}
        {!group && blocks.requestBlock && !iBlocked && (
          <IconButton
            icon="ban"
            size={18}
            label={`Block ${username}`}
            title={`Block ${username}`}
            onClick={() => blocks.requestBlock(username)}
            className="rounded-lg p-1.5 text-gray-400 transition hover:bg-ink-600 hover:text-fg"
          />
        )}
        {!group && onAddPeople && !blocked && (
          <IconButton
            icon="plus"
            size={18}
            label="Add people"
            title={`Start a group with ${username}`}
            onClick={onAddPeople}
            className="rounded-lg p-1.5 text-gray-400 transition hover:bg-ink-600 hover:text-fg"
          />
        )}
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
        emptyHeading={group ? `This is the beginning of ${name}` : `This is the beginning of your conversation with ${username}`}
        emptyBody="Say hi! 👋"
        onEditDone={() => composerRef.current?.focus()}
      />
      <TypingIndicator names={typing} />
      {blocked ? (
        <div role="status" className="m-3 flex items-center justify-between gap-3 rounded-xl bg-ink-800 px-4 py-3 text-sm text-gray-300 ring-1 ring-ink-500/40">
          <span>{iBlocked ? `You’ve blocked ${username}. Unblock to message them.` : 'You can’t message this person.'}</span>
          {iBlocked && blocks.unblock && (
            <button type="button" onClick={() => blocks.unblock(username)} className="shrink-0 rounded-lg bg-ink-600 px-3 py-1.5 text-sm font-medium text-fg hover:bg-ink-500">
              Unblock
            </button>
          )}
        </div>
      ) : (
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
          placeholder={group ? `Message ${name}` : `Message @${username}`}
        />
      )}
    </main>
  );
}
