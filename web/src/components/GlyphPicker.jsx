import { useState } from 'react';
import { SERVER_GLYPHS, glyphTileSvg, glyphToPng } from '../serverGlyphs.js';

// A row of ready-made server icons (P8). Picking one draws it to a PNG and
// hands the file to `onPick(file, glyph)`, which uploads it like any icon.
export default function GlyphPicker({ onPick, size = 36, label = 'Or pick one' }) {
  const [busy, setBusy] = useState(null); // the glyph being drawn
  const [error, setError] = useState('');

  async function pick(glyph) {
    setBusy(glyph.id);
    setError('');
    try {
      await onPick(await glyphToPng(glyph), glyph);
    } catch (err) {
      setError(err.message || 'Could not use that icon');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div role="group" aria-label="Ready-made icons">
      <div className="mb-1.5 text-xs text-gray-500">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {SERVER_GLYPHS.map((g) => (
          <button
            key={g.id}
            type="button"
            onClick={() => pick(g)}
            disabled={!!busy}
            aria-label={`Use the ${g.label.toLowerCase()} icon`}
            title={g.label}
            className={`tap overflow-hidden rounded-xl ring-offset-2 ring-offset-ink-800 transition hover:ring-2 hover:ring-brand-hi focus-visible:ring-2 focus-visible:ring-brand-hi disabled:opacity-60 ${busy === g.id ? 'animate-pulse' : ''}`}
            style={{ width: size, height: size }}
          >
            {/* Our own static markup (serverGlyphs.js), never user input. */}
            <span aria-hidden="true" className="block h-full w-full" dangerouslySetInnerHTML={{ __html: glyphTileSvg(g, size) }} />
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-1 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
