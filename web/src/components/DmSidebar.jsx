import Avatar from './Avatar.jsx';
import UserFooter from './UserFooter.jsx';

// The second column when in Direct Messages mode: a list of conversations.
export default function DmSidebar({
  conversations,
  currentDm,
  unread = {},
  onSelect,
  user,
  avatar,
  status,
  onOpenProfile,
  onLogout,
}) {
  return (
    <div className="flex w-60 flex-col bg-ink-800">
      <header className="flex h-12 items-center px-4 shadow-sm shadow-black/20">
        <h2 className="font-bold">Direct Messages</h2>
      </header>

      <div className="flex-1 overflow-y-auto px-2 py-3">
        {conversations.length === 0 && (
          <p className="px-2 text-sm text-gray-500">
            No conversations yet. Open a member in a server (right-hand list) to start one.
          </p>
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
              className={`mb-0.5 flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition ${
                active ? 'bg-ink-600' : 'hover:bg-ink-700/60'
              }`}
            >
              <Avatar name={c.username} size={32} src={c.avatar} />
              <div className="min-w-0 flex-1">
                <div className={`truncate text-sm ${hasUnread ? 'font-semibold text-white' : 'text-gray-200'}`}>
                  {c.username}
                </div>
                {preview && <div className="truncate text-xs text-gray-500">{preview}</div>}
              </div>
              {hasUnread && (
                <span className="shrink-0 rounded-full bg-danger px-1.5 text-xs font-bold text-white">
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
        onOpenProfile={onOpenProfile}
        onLogout={onLogout}
      />
    </div>
  );
}
