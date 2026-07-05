// Animated "X is typing…" line shown above the composer.
export default function TypingIndicator({ names }) {
  let text = '';
  if (names.length === 1) text = `${names[0]} is typing…`;
  else if (names.length === 2) text = `${names[0]} and ${names[1]} are typing…`;
  else if (names.length > 2) text = 'Several people are typing…';

  return (
    <div className="h-5 px-5 text-xs text-gray-400">
      {text && (
        <span className="inline-flex items-center gap-1">
          <span className="inline-flex gap-0.5">
            <Dot delay="0ms" />
            <Dot delay="150ms" />
            <Dot delay="300ms" />
          </span>
          {text}
        </span>
      )}
    </div>
  );
}

function Dot({ delay }) {
  return (
    <span
      className="inline-block h-1 w-1 animate-bounce rounded-full bg-gray-400"
      style={{ animationDelay: delay }}
    />
  );
}
