// The /imagine options above the message box (P2-20d): shape, quality, the
// engine (only when there's a choice) and how many are left today — or why
// /imagine can't be used here. Each group is labelled (P10-06). The chips keep focus in the message box (so
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

function Chips({ label, labelledBy, options, value, onChange, disabled }) {
  return (
    <div role="group" aria-label={labelledBy ? undefined : label} aria-labelledby={labelledBy} className="flex flex-wrap gap-1">
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

// One labelled group of chips (P10-06): a small label, then the chips, or,
// when the group doesn't apply right now, why ("ComfyUI only"). It keeps its
// place either way, so the panel doesn't jump as you change things.
function Option({ id, label, off, ...chips }) {
  return (
    <div className="flex min-h-6 min-w-0 items-center gap-2" data-option={id}>
      <span id={`imagine-opt-${id}`} className="w-14 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
        {label}
      </span>
      {off ? (
        <span className="text-xs italic text-gray-500" aria-describedby={`imagine-opt-${id}`}>
          {off}
        </span>
      ) : (
        <Chips label={label} labelledBy={`imagine-opt-${id}`} {...chips} />
      )}
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
  // Pictures (P9-05b): the chosen engine if it takes pictures, else ComfyUI.
  const pictureEngine = pictureEngineFor(imagine, engine);
  const pic = pictureEngine ? imagine.pictures[pictureEngine] : null;
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
        <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
          <Option id="shape" label="Shape" off={picture ? 'follows the picture' : null} options={SHAPES} value={shape} onChange={onShape} disabled={busy} />
          <Option id="quality" label="Quality" options={QUALITIES} value={quality} onChange={onQuality} disabled={busy} />
          {imagine.engines.length > 1 && (
            <Option id="engine" label="Engine" options={imagine.engines.map((e) => ({ v: e.id, label: e.name }))} value={engine} onChange={onEngine} disabled={busy} />
          )}
          {hasStyles(imagine) && (
            <Option
              id="style"
              label="Style"
              off={showStyles(imagine, engine) ? null : 'ComfyUI only'}
              options={imagine.styles.map((s) => ({ v: s.id, label: s.name }))}
              value={style}
              onChange={onStyle}
              disabled={busy}
            />
          )}
        </div>
      ) : (
        <p className="text-sm text-gray-400">{imagine.reason}</p>
      )}
      {imagine.available && pic && onPickPicture && (
        <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-ink-600/60 pt-2" role="group" aria-label="Start from a picture">
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
              {pic.strength ? (
                // The Shape row above already says the shape follows the picture (P10-06).
                <Chips label="Strength" options={STRENGTHS} value={strength} onChange={onStrength} disabled={busy} />
              ) : (
                <span className="text-xs text-gray-500">The picture guides the image; your prompt says what to change.</span>
              )}
              {pictureEngine !== engine && <span className="text-xs text-gray-500">Pictures use {engineName(imagine, pictureEngine)}.</span>}
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

// Which engine a picture request runs on (P9-05b, as the server decides):
// the chosen one if it takes pictures, else ComfyUI if it does, else none.
export function pictureEngineFor(imagine, engine) {
  if (imagine.pictures[engine]) return engine;
  return imagine.pictures.comfyui ? 'comfyui' : null;
}
const engineName = (imagine, id) => imagine.engines.find((e) => e.id === id)?.name || id;

// ComfyUI styles (P9-04c): offered when ComfyUI is the engine and there's a choice.
export function showStyles(imagine, engine) {
  return engine === 'comfyui' && imagine.styles.length > 1;
}
// Whether the Style row is there at all (P10-06): ComfyUI has a choice of
// styles. With another engine chosen it stays, saying "ComfyUI only".
const hasStyles = (imagine) => imagine.styles.length > 1 && imagine.engines.some((e) => e.id === 'comfyui');

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
    // P9-05b: the engines that take pictures, and whether each has a strength
    // (a server from before P9-05a: ComfyUI's, when it can vary).
    pictures: info.pictures || (info.canVary ? { comfyui: { strength: true } } : {}),
  };
}

// Where the daily limit comes from, in words (P3-21; matches the server's refusal).
export function limitSourceText(info, spaceName = 'This server') {
  const n = info.dailyLimit;
  if (info.limitSource === 'server') return `${spaceName} sets its own limit of ${n} a day (Server settings → Image generation).`;
  if (info.limitSource === 'ceiling') return `That's this instance's maximum of ${n} a day.`;
  return `This instance allows ${n} a day (Settings → Image generation).`;
}
