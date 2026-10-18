import { useState } from 'react';

// Retry and Variations on the /imagine bot's messages (P3-23). The bot's text
// comes only from the server's runner ("🎨 **name** imagined: …" with the
// image, or "⚠️ Couldn't imagine that for **name**: …"), so that's how its
// finished and failed requests are told apart.
export function imagineResultKind(m) {
  if (!m?.bot || typeof m.content !== 'string') return null;
  if (/^🎨 \*\*.+?\*\* imagined: /.test(m.content) && (m.attachments?.length || m.attachment)) return 'done';
  if (/^⚠️ Couldn't imagine that for \*\*/.test(m.content)) return 'failed';
  return null;
}

// `run(fields)` is the /imagine request for this channel; `{ from: id }` asks
// the server to repeat that request (as the person pressing).
export default function ImagineAgain({ m, kind, run }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const again = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await run({ from: m.id });
    } catch (err) {
      setError(err.message || 'Could not generate');
    } finally {
      setBusy(false);
    }
  };
  const label = kind === 'done' ? '🎲 Variations' : '↻ Retry';
  const title = kind === 'done' ? 'Make another take of this prompt' : 'Try this prompt again';
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={again}
        aria-busy={busy}
        title={title}
        className="tap-chip rounded-md bg-ink-600 px-2.5 py-1 text-xs font-medium text-gray-200 transition hover:bg-ink-500 aria-busy:opacity-60"
      >
        {busy ? 'Sending…' : label}
      </button>
      {error && (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}
    </div>
  );
}
