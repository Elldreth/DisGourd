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

export const STRENGTHS = [
  { v: 'subtle', label: 'Subtle' },
  { v: 'medium', label: 'Medium' },
  { v: 'strong', label: 'Strong' },
];

// `picture` (P3-36b): { url, name, fromReply? } to start from, or null;
// `onPickPicture(file)` attaches one; `onClearPicture` stops using it.
export default function ImaginePanel({
  imagine, shape, quality, engine, onShape, onQuality, onEngine, busy, error, style = null, onStyle,
  picture = null, strength = 'medium', onStrength, onPickPicture, onClearPicture, uploadingPicture = false,
}) {
  // Paid engines (kie.ai) carry a price per quality: the last real one, or an estimate.
  const price = imagine.engines.find((e) => e.id === engine)?.price?.[quality];
  const priceText = price ? `${price.estimate ? '≈ ' : ''}${price.credits} credits` : null;
  return (
    <div className="anim-pop mb-1 space-y-2 rounded-lg bg-ink-800 p-2.5 shadow-lg ring-1 ring-ink-500/50" aria-label="Image options" role="region">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-semibold text-gray-300">🎨 /imagine — describe the image, then press Enter</span>
        {imagine.available && (
          <span className="shrink-0 text-gray-400">
            {priceText && <span title="kie.ai credits for one image">{priceText} · </span>}
            {imagine.remaining} left today
          </span>
        )}
      </div>
      {imagine.available ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {!picture && <Chips label="Shape" options={SHAPES} value={shape} onChange={onShape} disabled={busy} />}
          <Chips label="Quality" options={QUALITIES} value={quality} onChange={onQuality} disabled={busy} />
          {imagine.engines.length > 1 && (
            <Chips label="Engine" options={imagine.engines.map((e) => ({ v: e.id, label: e.name }))} value={engine} onChange={onEngine} disabled={busy} />
          )}
          {showStyles(imagine, engine) && (
            <Chips label="Style" options={imagine.styles.map((s) => ({ v: s.id, label: s.name }))} value={style} onChange={onStyle} disabled={busy} />
          )}
        </div>
      ) : (
        <p className="text-sm text-gray-400">{imagine.reason}</p>
      )}
      {imagine.available && imagine.canVary && onPickPicture && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-ink-600/60 pt-2" role="group" aria-label="Start from a picture">
          {picture ? (
            <>
              <img src={picture.url} alt="" className="h-9 w-9 shrink-0 rounded object-cover ring-1 ring-ink-500" />
              <span className="min-w-0 max-w-[12rem] truncate text-xs text-gray-300" title={picture.name}>
                {picture.fromReply ? 'From the picture you’re replying to' : picture.name}
              </span>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={onClearPicture}
                aria-label="Don’t start from this picture"
                title="Don’t start from this picture"
                className="rounded px-1 text-xs text-gray-400 hover:bg-ink-600 hover:text-fg"
              >
                ✕
              </button>
              <Chips label="Strength" options={STRENGTHS} value={strength} onChange={onStrength} disabled={busy} />
              <span className="text-xs text-gray-500">The shape follows the picture.</span>
            </>
          ) : (
            <label className="cursor-pointer rounded-full bg-ink-600 px-2.5 py-0.5 text-xs font-medium text-gray-300 hover:bg-ink-500">
              {uploadingPicture ? 'Uploading…' : '🖼️ Start from a picture'}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                aria-label="Start from a picture"
                disabled={busy}
                onChange={(e) => {
                  onPickPicture(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </label>
          )}
        </div>
      )}
      {busy && <p className="text-xs text-gray-400">Sending…</p>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}

// ComfyUI styles (P9-04c): offered when ComfyUI is the engine and there's a choice.
export function showStyles(imagine, engine) {
  return engine === 'comfyui' && imagine.styles.length > 1;
}

// The style to preselect: the one this device last used, if it's still there, else the default.
const STYLE_KEY = 'disgourd.imagineStyle';
export function startingStyle(imagine) {
  let last = '';
  try {
    last = localStorage.getItem(STYLE_KEY) || '';
  } catch {
    // storage blocked: just use the default
  }
  return imagine.styles.some((s) => s.id === last) ? last : imagine.defaultStyle || imagine.styles[0]?.id || null;
}
export function rememberStyle(id) {
  try {
    localStorage.setItem(STYLE_KEY, id);
  } catch {
    // storage blocked: not remembered
  }
}

// The Composer's /imagine for one channel (or thread) of a server: its state
// from the server list, with a `run` that sends the request there.
export function imagineFor(spaces, space, channel, request) {
  const info = (spaces || []).find((s) => s.name === space)?.imagine;
  return imagineState(info, (fields) => request({ space, channel, ...fields }), space);
}

// What the Composer needs from a server's `imagine` info (from GET /spaces):
// null when the server knows nothing of /imagine (it then isn't offered).
export function imagineState(info, run, spaceName = 'This server') {
  if (!info) return null;
  const remaining = Math.max(0, (info.dailyLimit || 0) - (info.usedToday || 0));
  let reason = null;
  if (!info.serverEnabled) reason = '/imagine is off in this server. Its owner can turn it on from the server menu.';
  else if (!info.engines?.length) reason = 'No image engine is set up on this instance yet.';
  else if (!info.canUse) reason = 'You don’t have the Generate images permission in this server.';
  else if (remaining <= 0) reason = `You’ve used all ${info.dailyLimit} images for today. ${limitSourceText(info, spaceName)}`;
  return {
    available: !reason, reason, remaining, engines: info.engines || [], run, canUpscale: !!info.canUpscale, canVary: !!info.canVary,
    styles: info.styles || [], defaultStyle: info.defaultStyle || null, // P9-04c
  };
}

// Where the daily limit comes from, in words (P3-21; matches the server's refusal).
export function limitSourceText(info, spaceName = 'This server') {
  const n = info.dailyLimit;
  if (info.limitSource === 'server') return `${spaceName} sets its own limit of ${n} a day (Server settings → Image generation).`;
  if (info.limitSource === 'ceiling') return `That's this instance's maximum of ${n} a day.`;
  return `This instance allows ${n} a day (Settings → Image generation).`;
}
