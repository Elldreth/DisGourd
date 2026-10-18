import { useState } from 'react';

// Retry and Variations on the /imagine bot's messages (P3-23). The bot's text
// comes only from the server's runner ("🎨 **name** imagined: …" with the
// image, or "⚠️ Couldn't imagine that for **name**: …"), so that's how its
// finished and failed requests are told apart.
export function imagineResultKind(m) {
  if (!m?.bot || typeof m.content !== 'string') return null;
  const hasImage = !!(m.attachments?.length || m.attachment);
  if (/^🎨 \*\*.+?\*\* imagined: /.test(m.content) && hasImage) return 'done';
  if (/^🔍 \*\*.+?\*\* upscaled: /.test(m.content) && hasImage) return 'upscaled'; // P3-29
  if (/^⚠️ Couldn't imagine that for \*\*/.test(m.content)) return 'failed';
  return null;
}

// `run(fields)` is the /imagine request for this channel; `{ from: id }` asks
// the server to repeat that request (as the person pressing), and with
// `upscale: true` (P3-29) to make it 2× bigger. `canUpscale`: ComfyUI is on.
export default function ImagineAgain({ m, kind, run, canUpscale = false }) {
  const [busy, setBusy] = useState(null); // which button is sending
  const [error, setError] = useState(null);
  const send = async (which, fields) => {
    if (busy) return;
    setBusy(which);
    setError(null);
    try {
      await run({ from: m.id, ...fields });
    } catch (err) {
      setError(err.message || 'Could not generate');
    } finally {
      setBusy(null);
    }
  };
  const chip = 'tap-chip rounded-md bg-ink-600 px-2.5 py-1 text-xs font-medium text-gray-200 transition hover:bg-ink-500 aria-busy:opacity-60';
  const repeat = kind === 'failed' ? { label: '↻ Retry', title: 'Try this again' } : { label: '🎲 Variations', title: 'Make another take of this prompt' };
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => send('again', {})} aria-busy={busy === 'again'} title={repeat.title} className={chip}>
        {busy === 'again' ? 'Sending…' : repeat.label}
      </button>
      {kind === 'done' && canUpscale && (
        <button type="button" onClick={() => send('upscale', { upscale: true })} aria-busy={busy === 'upscale'} title="Make this image twice as big" className={chip}>
          {busy === 'upscale' ? 'Sending…' : '🔍 Upscale 2×'}
        </button>
      )}
      {error && (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}
    </div>
  );
}
