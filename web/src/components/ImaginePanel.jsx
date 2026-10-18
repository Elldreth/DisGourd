// The /imagine options above the message box (P2-20d): shape, quality, the
// engine (only when there's a choice) and how many are left today — or why
// /imagine can't be used here. The chips keep focus in the message box (so
// Enter still generates); they're still reachable with Tab.
export const SHAPES = [
  { v: 'square', label: 'Square' },
  { v: 'portrait', label: 'Portrait' },
  { v: 'landscape', label: 'Landscape' },
  { v: 'wide', label: 'Wide' },
];
export const QUALITIES = [
  { v: 'draft', label: 'Draft' },
  { v: 'standard', label: 'Standard' },
  { v: 'high', label: 'High' },
];

function Chips({ label, options, value, onChange, disabled }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          aria-pressed={value === o.v}
          disabled={disabled}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onChange(o.v)}
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition disabled:opacity-50 ${
            value === o.v ? 'bg-brand text-white' : 'bg-ink-600 text-gray-300 hover:bg-ink-500'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function ImaginePanel({ imagine, shape, quality, engine, onShape, onQuality, onEngine, busy, error }) {
  return (
    <div className="anim-pop mb-1 space-y-2 rounded-lg bg-ink-800 p-2.5 shadow-lg ring-1 ring-ink-500/50" aria-label="Image options" role="region">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-semibold text-gray-300">🎨 /imagine — describe the image, then press Enter</span>
        {imagine.available && <span className="shrink-0 text-gray-400">{imagine.remaining} left today</span>}
      </div>
      {imagine.available ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <Chips label="Shape" options={SHAPES} value={shape} onChange={onShape} disabled={busy} />
          <Chips label="Quality" options={QUALITIES} value={quality} onChange={onQuality} disabled={busy} />
          {imagine.engines.length > 1 && (
            <Chips label="Engine" options={imagine.engines.map((e) => ({ v: e.id, label: e.name }))} value={engine} onChange={onEngine} disabled={busy} />
          )}
        </div>
      ) : (
        <p className="text-sm text-gray-400">{imagine.reason}</p>
      )}
      {busy && <p className="text-xs text-gray-400">Sending…</p>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}

// The Composer's /imagine for one channel (or thread) of a server: its state
// from the server list, with a `run` that sends the request there.
export function imagineFor(spaces, space, channel, request) {
  const info = (spaces || []).find((s) => s.name === space)?.imagine;
  return imagineState(info, (fields) => request({ space, channel, ...fields }));
}

// What the Composer needs from a server's `imagine` info (from GET /spaces):
// null when the server knows nothing of /imagine (it then isn't offered).
export function imagineState(info, run) {
  if (!info) return null;
  const remaining = Math.max(0, (info.dailyLimit || 0) - (info.usedToday || 0));
  let reason = null;
  if (!info.serverEnabled) reason = '/imagine is off in this server. Its owner can turn it on from the server menu.';
  else if (!info.engines?.length) reason = 'No image engine is set up on this instance yet.';
  else if (!info.canUse) reason = 'You don’t have the Generate images permission in this server.';
  else if (remaining <= 0) reason = `You’ve used all ${info.dailyLimit} images for today.`;
  return { available: !reason, reason, remaining, engines: info.engines || [], run };
}
