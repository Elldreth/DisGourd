import Avatar from './Avatar.jsx';
import EmptyState from './EmptyState.jsx';
import IconButton from './IconButton.jsx';
import UserFooter from './UserFooter.jsx';
import { unreadLabel } from '../util.js';

// The second column when in Direct Messages mode: a list of conversations.
export default function DmSidebar({
  conversations,
  currentDm,
  unread = {},
  onSelect,
  user,
  avatar,
  status,
  presence,
  onSetPresence,
  statusText,
  statusEmoji,
  onEditStatus,
  onOpenShortcuts,
  onOpenProfile,
  onLogout,
  onNewMessage,
}) {
  return (
    <nav aria-label="Direct messages" className="flex w-60 flex-col border-r border-ink-900/50 bg-ink-800">
      <header className="flex h-12 items-center justify-between border-b border-ink-900/60 pl-4 pr-2 shadow-xs shadow-black/20">
        <h2 className="font-bold">Direct Messages</h2>
        {onNewMessage && (
          <IconButton
            icon="edit"
            size={18}
            label="New message"
            title="New message (Ctrl+Shift+K)"
            onClick={onNewMessage}
            className="tap rounded-lg p-1.5 text-gray-400 transition hover:bg-ink-600 hover:text-fg"
          />
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-2 py-3">
        {conversations.length === 0 && (
          <EmptyState
            compact
            art="dms"
            title="No conversations yet"
            action={onNewMessage ? { label: 'New message', onClick: onNewMessage } : undefined}
          />
        )}
        {conversations.map((c) => {
          const active = c.username === currentDm;
          const count = unread[c.username] || 0;
          const hasUnread = count > 0 && !active;
          const preview = c.lastContent || (c.lastAttachment ? '📎 Attachment' : '');
          return (
            <button
              key={c.username}
              onClick={() => onSelect(c.username)}
              className={`tap-row mb-0.5 flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition ${
                active ? 'bg-ink-600' : 'hover:bg-ink-700/60'
              }`}
            >
              <Avatar name={c.username} size={32} src={c.avatar} />
              <div className="min-w-0 flex-1">
                <div className={`truncate text-sm ${hasUnread ? 'font-semibold text-fg' : 'text-gray-200'}`}>
                  {c.username}
                </div>
                {preview && <div className="truncate text-xs text-gray-500">{preview}</div>}
              </div>
              {hasUnread && <span className="sr-only">, {unreadLabel({ unread: count })}</span>}
              {hasUnread && (
                <span aria-hidden="true" className="shrink-0 rounded-full bg-danger px-1.5 text-xs font-bold text-ink-900">
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <UserFooter
        user={user}
        avatar={avatar}
        status={status}
        presence={presence}
        onSetPresence={onSetPresence}
        statusText={statusText}
        statusEmoji={statusEmoji}
        onEditStatus={onEditStatus}
        onOpenShortcuts={onOpenShortcuts}
        onOpenProfile={onOpenProfile}
        onLogout={onLogout}
      />
    </nav>
  );
}
