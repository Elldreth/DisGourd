import { useRef } from 'react';
import Avatar from './Avatar.jsx';
import MessageList from './MessageList.jsx';
import Composer from './Composer.jsx';
import TypingIndicator from './TypingIndicator.jsx';
import Icon from './Icon.jsx';
import DropOverlay from './DropOverlay.jsx';
import { useFileDrop } from '../useFileDrop.js';

// The conversation view in Direct Messages mode.
export default function DmPanel({ username, messages, currentUser, typing = [], onSend, onEdit, onDelete, hasMore, loadingOlder, onLoadOlder, onTyping, onOpenSearch, onOpenNav }) {
  // Files dropped anywhere on the conversation go to the composer.
  const composerRef = useRef(null);
  const listRef = useRef(null);
  const drop = useFileDrop({ enabled: !!username, onFiles: (files) => composerRef.current?.addFiles(files) });

  if (!username) {
    return (
      <main className="relative flex min-w-0 flex-1 flex-col items-center justify-center bg-ink-700 p-8 text-center">
        {onOpenNav && (
          <button
            onClick={onOpenNav}
            title="Conversations"
            className="absolute left-2 top-2 rounded-lg p-2 text-gray-300 transition hover:bg-ink-600 hover:text-fg md:hidden"
          >
            <Icon name="menu" size={22} />
          </button>
        )}
        <div className="mb-3 text-6xl">💬</div>
        <h2 className="text-xl font-bold">Your messages</h2>
        <p className="mt-1 max-w-sm text-gray-400">
          Pick a conversation, or open a member in one of your servers to start a new one.
        </p>
      </main>
    );
  }

  return (
    <main className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-ink-700" {...drop.dropProps}>
      {drop.dragging && <DropOverlay target={`@${username}`} />}
      <header className="flex h-12 items-center gap-2 border-b border-ink-900/60 px-3 shadow-xs shadow-black/20 md:px-4">
        <button
          onClick={onOpenNav}
          title="Conversations"
          className="-ml-1 rounded-lg p-1.5 text-gray-300 transition hover:bg-ink-600 hover:text-fg md:hidden"
        >
          <Icon name="menu" size={20} />
        </button>
        <Avatar name={username} size={24} />
        <h2 className="font-bold">{username}</h2>
        <div className="flex-1" />
        <button
          onClick={onOpenSearch}
          title="Search messages"
          className="rounded-lg p-1.5 text-gray-400 transition hover:bg-ink-600 hover:text-fg"
        >
          <Icon name="search" size={18} />
        </button>
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
        simple
        emptyHeading={`This is the beginning of your conversation with ${username}`}
        emptyBody="Say hi! 👋"
        onEditDone={() => composerRef.current?.focus()}
      />
      <TypingIndicator names={typing} />
      <Composer ref={composerRef} onEditLast={() => listRef.current?.startEditLast() ?? false} channel={username} disabled={false} onSend={onSend} onTyping={onTyping} placeholder={`Message @${username}`} />
    </main>
  );
}
