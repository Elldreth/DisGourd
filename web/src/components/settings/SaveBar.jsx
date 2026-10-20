// "You have unsaved changes · Reset · Save changes", stuck to the bottom of a
// settings page while something has changed (P5-02). Used where changes are
// shared or risky (site admin, server, channel); personal settings apply at
// once and don't use it.
export default function SaveBar({ dirty, saving = false, error = '', onSave, onReset }) {
  if (!dirty) return null;
  return (
    <div
      role="region"
      aria-label="Unsaved changes"
      className="anim-pop sticky bottom-0 z-10 mt-6 flex flex-wrap items-center gap-3 rounded-xl bg-ink-900 px-4 py-3 shadow-xl ring-1 ring-ink-500/60"
    >
      <span className="min-w-0 flex-1 text-sm text-gray-200">
        You have unsaved changes
        {error && (
          <span role="alert" className="block text-xs text-danger">
            {error}
          </span>
        )}
      </span>
      <button type="button" onClick={onReset} disabled={saving} className="tap rounded-lg px-3 py-1.5 text-sm text-gray-300 transition hover:text-fg disabled:opacity-50">
        Reset
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        className="tap rounded-lg bg-brand px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-hover disabled:opacity-60"
      >
        {saving ? 'Saving…' : 'Save changes'}
      </button>
    </div>
  );
}
