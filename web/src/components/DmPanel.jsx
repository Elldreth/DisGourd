import Avatar from './Avatar.jsx';
import MessageList from './MessageList.jsx';
import Composer from './Composer.jsx';
import TypingIndicator from './TypingIndicator.jsx';

// The conversation view in Direct Messages mode.
export default function DmPanel({ username, messages, currentUser, typing = [], onSend, onTyping }) {
  if (!username) {
    return (
      <main className="flex min-w-0 flex-1 flex-col items-center justify-center bg-ink-700 p-8 text-center">
        <div className="mb-3 text-6xl">💬</div>
        <h2 className="text-xl font-bold">Your messages</h2>
        <p className="mt-1 max-w-sm text-gray-400">
          Pick a conversation, or open a member in one of your servers to start a new one.
        </p>
      </main>
    );
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-ink-700">
      <header className="flex h-12 items-center gap-2 border-b border-ink-900/60 px-4 shadow-sm shadow-black/20">
        <Avatar name={username} size={24} />
        <h2 className="font-bold">{username}</h2>
      </header>

      <MessageList
        messages={messages}
        currentUser={currentUser}
        simple
        emptyHeading={`This is the beginning of your conversation with ${username}`}
        emptyBody="Say hi! 👋"
      />
      <TypingIndicator names={typing} />
      <Composer channel={username} disabled={false} onSend={onSend} onTyping={onTyping} placeholder={`Message @${username}`} />
    </main>
  );
}
