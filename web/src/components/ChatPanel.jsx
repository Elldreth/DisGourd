import MessageList from './MessageList.jsx';
import Composer from './Composer.jsx';
import TypingIndicator from './TypingIndicator.jsx';
import Icon from './Icon.jsx';
import Gourd from './Gourd.jsx';

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
  onReact,
  onTyping,
  onOpenSearch,
}) {
  if (!space) {
    return (
      <Empty
        title="No server selected"
        body="Pick a server on the left, or press + to create one and invite your friends."
      />
    );
  }
  if (!channel) {
    return (
      <Empty
        title={`Welcome to ${space}`}
        body="Create a text channel with the + next to “Text channels” to start talking."
      />
    );
  }

  const degraded = status === 'reconnecting' || status === 'closed' || status === 'connecting';

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-ink-700">
      <header className="flex h-12 items-center gap-2 border-b border-ink-900/60 px-4 shadow-sm shadow-black/20">
        <Icon name="hash" size={20} className="text-gray-500" />
        <h2 className="font-bold">{channel}</h2>
        <div className="flex-1" />
        <button
          onClick={onOpenSearch}
          title="Search messages"
          className="rounded-lg p-1.5 text-gray-400 transition hover:bg-ink-600 hover:text-white"
        >
          <Icon name="search" size={18} />
        </button>
      </header>

      {degraded && (
        <div className="bg-idle/20 px-4 py-1 text-center text-sm text-idle">
          {status === 'closed' ? 'Disconnected — retrying…' : 'Reconnecting…'} Messages you send will
          be delivered once you’re back online.
        </div>
      )}

      <MessageList
        messages={messages}
        channel={channel}
        currentUser={currentUser}
        onEdit={onEdit}
        onDelete={onDelete}
        onReact={onReact}
      />
      <TypingIndicator names={typingUsers} />
      {canPost ? (
        // Always enabled: sends during a blip are queued and flushed on reconnect.
        <Composer
          channel={channel}
          disabled={false}
          onSend={onSend}
          onTyping={onTyping}
          mentionCandidates={memberNames}
        />
      ) : (
        <div className="mx-4 mb-5 mt-1 flex items-center justify-center gap-2 rounded-xl bg-ink-800 px-4 py-3 text-center text-sm text-gray-400 ring-1 ring-ink-500/40">
          <Icon name="shield" size={15} className="shrink-0" /> You don’t have permission to post in this channel.
        </div>
      )}
    </main>
  );
}

function Empty({ title, body }) {
  return (
    <main className="flex min-w-0 flex-1 flex-col items-center justify-center bg-ink-700 p-8 text-center">
      <Gourd size={72} color="#7d6ff3" className="mb-3" />
      <h2 className="text-xl font-bold">{title}</h2>
      <p className="mt-1 max-w-sm text-gray-400">{body}</p>
    </main>
  );
}
