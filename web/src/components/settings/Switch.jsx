// An on/off switch for settings (P5-02). It's a real checkbox with
// role="switch", so it keeps the checkbox's keyboard (Space), its label
// clicks and its `checked`, and screen readers announce "switch, on/off".
// The input is invisible over a drawn track and knob, drawn from `checked`.
//   <Switch label="Message sounds" checked={on} onChange={(next) => …} />
// `label` is its accessible name; put the visible words in a SettingRow.
export default function Switch({ label, checked, onChange, disabled = false, id }) {
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center coarse:min-h-11 coarse:min-w-11">
      <input
        id={id}
        type="checkbox"
        role="switch"
        aria-label={label}
        checked={!!checked}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
        className="peer absolute inset-0 z-10 m-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
      />
      <span
        aria-hidden="true"
        className={`flex h-6 w-11 items-center rounded-full p-0.5 transition-colors peer-disabled:opacity-50 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-hi peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-ink-800 ${
          checked ? 'bg-brand' : 'bg-gray-500'
        }`}
      >
        <span className={`h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-5' : ''}`} />
      </span>
    </span>
  );
}
