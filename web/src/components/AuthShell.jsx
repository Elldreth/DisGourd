import Gourd from './Gourd.jsx';

// The framing for the logged-out screens (sign in, register, first-run setup).
// A single soft brand glow lifts the card off the page and one large gourd
// bleeds off the corner as a quiet watermark — enough atmosphere to feel
// finished, restrained enough to stay out of the form's way.
export default function AuthShell({ title, subtitle, children }) {
  return (
    <div className="relative flex h-full items-center justify-center overflow-hidden bg-ink-900 p-4">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-1/2 h-[460px] w-[460px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand/10 blur-[120px]" />
        <Gourd size={560} color="#8f83f7" className="absolute -bottom-40 -right-28 opacity-[0.05]" />
      </div>

      <div className="anim-scale-in relative z-10 w-full max-w-md rounded-2xl bg-ink-800/90 p-8 shadow-2xl ring-1 ring-ink-500/40 backdrop-blur-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand shadow-lg shadow-brand/30">
            <Gourd size={36} color="#fff" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          <div className="mx-auto mt-1.5 max-w-xs text-sm text-gray-400">{subtitle}</div>
        </div>
        {children}
      </div>
    </div>
  );
}

// Shared labelled field used by the auth forms.
export function Field({ label, hint, children }) {
  return (
    <label className="block">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</span>
        {hint && <span className="text-xs text-gray-500">{hint}</span>}
      </div>
      {children}
    </label>
  );
}
