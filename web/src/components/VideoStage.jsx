import { useEffect, useRef } from 'react';

// One video tile. React owns the <video>; we set srcObject imperatively since a
// MediaStream can't be passed as an attribute.
function Tile({ tile }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (el && el.srcObject !== tile.stream) el.srcObject = tile.stream;
  }, [tile.stream]);
  return (
    <div className="relative aspect-video overflow-hidden rounded-lg bg-black ring-1 ring-ink-500/40">
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={tile.self}
        className={`h-full w-full object-contain ${tile.mirror ? '-scale-x-100' : ''}`}
      />
      <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-xs text-white">
        {tile.label || 'Video'}
      </span>
    </div>
  );
}

// The video grid shown above the chat while anyone in your voice call has their
// camera or screen on. Tiles reflow responsively.
export default function VideoStage({ videos }) {
  if (!videos || videos.length === 0) return null;
  return (
    <div className="max-h-[45vh] shrink-0 overflow-y-auto border-b border-ink-900/60 bg-ink-900 p-3">
      <div
        className="grid justify-center gap-2"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 260px))' }}
      >
        {videos.map((t) => (
          <Tile key={t.key} tile={t} />
        ))}
      </div>
    </div>
  );
}
