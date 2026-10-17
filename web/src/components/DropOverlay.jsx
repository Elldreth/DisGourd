import Icon from './Icon.jsx';

// Shown over a chat panel while files are dragged onto it (see useFileDrop).
export default function DropOverlay({ target }) {
  return (
    <div className="anim-fade pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-ink-900/70 p-6">
      <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-brand-hi bg-ink-800/90 px-10 py-8 text-center shadow-xl">
        <Icon name="plus" size={32} className="text-brand-hi" />
        <p className="text-lg font-semibold text-gray-100">Drop to upload to {target}</p>
        <p className="text-sm text-gray-400">Up to 10 files per message</p>
      </div>
    </div>
  );
}
