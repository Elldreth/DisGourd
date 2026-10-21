import Avatar from './Avatar.jsx';
import GroupAvatar from './GroupAvatar.jsx';
import EmptyState from './EmptyState.jsx';
import IconButton from './IconButton.jsx';
import UserFooter from './UserFooter.jsx';
import { unreadLabel } from '../util.js';

// The second column when in Direct Messages mode: a list of conversations,
// each with its `key` (P9-06b: `c:<id>`, or `@name` while being started).
// P10-04: a group's preview names who said it ("bob: …", "You: …"); a
// notice ("bob started the group") already does.
export function groupPreview(c, myId, preview) {
  if (!preview || c.lastKind === 'system' || c.lastAuthorId == null) return preview;
  const who = c.lastAuthorId === myId ? 'You' : (c.members || []).find((m) => m.id === c.lastAuthorId)?.username;
  return who ? `${who}: ${preview}` : preview;
}
export default function DmSidebar({
  conversations,
  currentDm,
  titleOf = (c) => c.username, // P9-06d: a group's name or members
  myId = null,
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
          const active = c.key === currentDm;
          const count = unread[c.key] || 0;
          const hasUnread = count > 0 && !active;
          const preview = c.lastContent || (c.lastAttachment ? '📎 Attachment' : '');
          const group = c.kind === 'group';
          const name = titleOf(c);
          return (
            <button
              key={c.key}
              onClick={() => onSelect(c.key)}
              className={`tap-row mb-0.5 flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition ${
                active ? 'bg-ink-600' : 'hover:bg-ink-700/60'
              } ${c.muted && !active ? 'opacity-60' : ''}`}
            >
              {group ? (
                <GroupAvatar members={(c.members || []).filter((m) => m.id !== myId)} size={32} />
              ) : (
                <Avatar name={c.username} size={32} src={c.avatar} />
              )}
              <div className="min-w-0 flex-1">
                <div className={`truncate text-sm ${hasUnread ? 'font-semibold text-fg' : 'text-gray-200'}`}>
                  {name}
                </div>
                {group ? (
                  <div className="truncate text-xs text-gray-500">{groupPreview(c, myId, preview) || `${c.members?.length || 0} members`}</div>
                ) : (
                  preview && <div className="truncate text-xs text-gray-500">{preview}</div>
                )}
              </div>
              {c.muted && <span className="sr-only">, muted</span>}
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
