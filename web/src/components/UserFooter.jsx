import Avatar from './Avatar.jsx';

const STATUS_LABEL = {
  idle: { text: 'Not connected', color: 'bg-gray-500' },
  connecting: { text: 'Connecting…', color: 'bg-idle animate-pulse' },
  open: { text: 'Connected', color: 'bg-online' },
  reconnecting: { text: 'Reconnecting…', color: 'bg-idle animate-pulse' },
  closed: { text: 'Disconnected', color: 'bg-danger' },
};

// The current-user strip shown at the bottom of the left sidebar, with live
// connection status, a click-through to the profile dialog, and sign-out.
export default function UserFooter({ user, avatar, status, onOpenProfile, onLogout }) {
  const st = STATUS_LABEL[status] || STATUS_LABEL.idle;
  return (
    <div className="flex items-center gap-1 bg-ink-900/60 px-2 py-2">
      <button
        onClick={onOpenProfile}
        title="Edit your profile"
        className="flex min-w-0 flex-1 items-center gap-2 rounded p-1 text-left transition hover:bg-ink-600/50"
      >
        <Avatar name={user} size={32} status="online" src={avatar} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{user}</div>
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            <span className={`h-2 w-2 rounded-full ${st.color}`} />
            {st.text}
          </div>
        </div>
      </button>
      <button
        onClick={onLogout}
        title="Sign out"
        className="rounded p-1.5 text-gray-400 transition hover:bg-ink-600 hover:text-white"
      >
        ⎋
      </button>
    </div>
  );
}
