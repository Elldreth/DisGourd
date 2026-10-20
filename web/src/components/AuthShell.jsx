import Mascot from './Mascot.jsx';
import LoginArt from './LoginArt.jsx';

// The framing for the logged-out screens (sign in, register, first-run setup).
// Flat on purpose: a solid card on the deepest surface, a vine of gourds
// around it (P8), and the mascot waving hello at the top of the card (`pose`
// changes it, e.g. a party for the setup wizard's last step).
export default function AuthShell({ title, subtitle, pose = 'wave', children }) {
  return (
    // <main>: the signed-out screens' one landmark, so the card isn't outside every region (axe).
    <main className="relative flex h-full items-center justify-center overflow-hidden bg-ink-900 p-4">
      <LoginArt />

      <div className="anim-scale-in relative z-10 w-full max-w-md rounded-2xl bg-ink-800 p-8 ring-1 ring-ink-500">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex justify-center">
            <Mascot pose={pose} size={84} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          <div className="mx-auto mt-1.5 max-w-xs text-sm text-gray-400">{subtitle}</div>
        </div>
        {children}
      </div>
    </main>
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
