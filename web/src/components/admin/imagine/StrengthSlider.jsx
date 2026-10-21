import { heading } from './constants.js';

// A 0–1 strength as a slider with its value shown (P10-05), in place of a
// bare number box. The ends say what each way means; "Reset" goes back to
// the default.
//   <StrengthSlider id="imagine-hires-denoise" label="Hires strength" value={0.45} onChange={(v) => …}
//     min={0.1} max={0.8} defaultValue={0.45} low="closer to the original" high="more new detail" />
export default function StrengthSlider({ id, label, value, onChange, min = 0, max = 1, step = 0.05, defaultValue, low, high, help }) {
  const n = Number(value);
  const shown = Number.isFinite(n) ? n.toFixed(2) : '';
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <label htmlFor={id} className={heading.replace('mb-1 ', '')}>{label}</label>
        <span className="flex items-baseline gap-2">
          <output htmlFor={id} className="font-mono text-sm text-fg">{shown}</output>
          {defaultValue != null && Math.abs(n - defaultValue) > 1e-9 && (
            <button type="button" onClick={() => onChange(defaultValue)} className="rounded px-1 text-xs text-brand-hi hover:bg-ink-700">
              Reset to {defaultValue}
            </button>
          )}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={Number.isFinite(n) ? n : defaultValue ?? min}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-brand"
      />
      {(low || high) && (
        <div className="flex justify-between text-[11px] text-gray-500" aria-hidden="true">
          <span>{low}</span>
          <span>{high}</span>
        </div>
      )}
      {help && <p className="mt-1 text-xs text-gray-500">{help}</p>}
    </div>
  );
}
