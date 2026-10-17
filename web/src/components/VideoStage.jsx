import { useEffect, useRef, useState } from 'react';
import IconButton from './IconButton.jsx';

// One video tile. React owns the <video>; we set srcObject imperatively since a
// MediaStream can't be passed as an attribute. Clicking the tile pins it; the
// corner buttons pin and go full screen (shown on hover or keyboard focus).
function Tile({ tile, pinned, spotlight, fullscreenEl, onTogglePin, className = '' }) {
  const box = useRef(null);
  const video = useRef(null);
  useEffect(() => {
    const el = video.current;
    if (el && el.srcObject !== tile.stream) el.srcObject = tile.stream;
  }, [tile.stream]);

  const isFull = !!box.current && fullscreenEl === box.current;
  function toggleFullscreen(e) {
    e.stopPropagation();
    // The browser can refuse (no permission, an embedding frame); nothing to do then.
    if (isFull) document.exitFullscreen?.()?.catch?.(() => {});
    else box.current?.requestFullscreen?.()?.catch?.(() => {});
  }
  const name = tile.label || 'Video';

  return (
    <div
      ref={box}
      role="group"
      aria-label={tile.speaking ? `${name}, speaking` : name}
      data-spotlight={spotlight}
      onClick={() => !isFull && onTogglePin()}
      className={`group relative cursor-pointer overflow-hidden rounded-lg bg-black [&:fullscreen]:cursor-default [&:fullscreen]:rounded-none ${
        tile.speaking ? 'ring-2 ring-online' : 'ring-1 ring-ink-500/40'
      } ${className}`}
    >
      <video
        ref={video}
        autoPlay
        playsInline
        muted={tile.self}
        className={`h-full w-full object-contain ${tile.mirror ? '-scale-x-100' : ''}`}
      />
      <span className="absolute bottom-1 left-1 rounded-sm bg-black/60 px-1.5 py-0.5 text-xs text-white">{name}</span>
      <div className="absolute right-1 top-1 flex gap-1 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:hover)]:opacity-0">
        {!isFull && (
          <IconButton
            icon="pin"
            size={15}
            label={`Pin ${name}`}
            title={pinned ? 'Unpin' : 'Pin'}
            pressed={pinned}
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin();
            }}
            className={`rounded-md p-1.5 text-white ${pinned ? 'bg-brand' : 'bg-black/60 hover:bg-black/80'}`}
          />
        )}
        <IconButton
          icon={isFull ? 'minimize' : 'maximize'}
          size={15}
          label={isFull ? 'Exit full screen' : `Full screen: ${name}`}
          title={isFull ? 'Exit full screen (Esc)' : 'Full screen'}
          onClick={toggleFullscreen}
          className="rounded-md bg-black/60 p-1.5 text-white hover:bg-black/80"
        />
      </div>
    </div>
  );
}

// The video area shown above the chat while anyone in your voice call has their
// camera or screen on: a grid of tiles, or one pinned tile large with the rest
// small below it. A pinned tile that goes away (share stopped) unpins.
export default function VideoStage({ videos }) {
  const [pinned, setPinned] = useState(null);
  const [fullscreenEl, setFullscreenEl] = useState(null);
  const present = !!videos?.some((v) => v.key === pinned);

  useEffect(() => {
    if (pinned && !present) setPinned(null);
  }, [pinned, present]);

  useEffect(() => {
    const sync = () => setFullscreenEl(document.fullscreenElement || null);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  if (!videos || videos.length === 0) return null;
  const toggle = (key) => setPinned((p) => (p === key ? null : key));
  const common = (t) => ({ tile: t, pinned: pinned === t.key, fullscreenEl, onTogglePin: () => toggle(t.key) });

  // One grid either way, so tiles (and their <video>s) never remount: the
  // pinned tile just spans the full width and moves first.
  return (
    <div className={`${present ? 'max-h-[65vh]' : 'max-h-[45vh]'} shrink-0 overflow-y-auto border-b border-ink-900/60 bg-ink-900 p-3`}>
      <div
        className="grid justify-center gap-2"
        style={{ gridTemplateColumns: present ? 'repeat(auto-fill, minmax(140px, 160px))' : 'repeat(auto-fill, minmax(200px, 260px))' }}
      >
        {videos.map((t) => {
          const isMain = present && t.key === pinned;
          return (
            <Tile
              key={t.key}
              {...common(t)}
              spotlight={present ? String(isMain) : undefined}
              className={isMain ? 'order-first col-span-full h-[45vh] w-full' : 'aspect-video'}
            />
          );
        })}
      </div>
    </div>
  );
}
