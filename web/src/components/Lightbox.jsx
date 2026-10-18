import { useEffect, useState } from 'react';
import { attachmentInfo } from '../util.js';
import Icon from './Icon.jsx';
import Modal from './Modal.jsx';

// Full-screen media viewer (a Modal dialog). Click around the media or ✕ to
// close (also Esc); the arrows / ← → keys move between items in the album.
// Below the media (P3-30): its real size in pixels, Download and Open original.
export default function Lightbox({ items, index, onClose, onIndex }) {
  const count = items.length;
  const [size, setSize] = useState(null); // { w, h } of the item on show, once loaded
  const go = (delta) => onIndex((index + delta + count) % count);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowRight' && count > 1) go(1);
      else if (e.key === 'ArrowLeft' && count > 1) go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, count]);

  const info = attachmentInfo(items[index]);
  useEffect(() => setSize(null), [info?.url]);
  if (!info) return null;

  const kind = info.isVideo ? 'Video' : 'Image';
  const label = count > 1 ? `${kind} ${index + 1} of ${count}: ${info.name}` : `${kind}: ${info.name}`;

  return (
    <Modal onClose={onClose} label={label} fill animate={false} backdropClassName="bg-black/90" panelClassName="flex items-center justify-center">
      {/* Close */}
      <button
        onClick={onClose}
        title="Close (Esc)"
        aria-label="Close"
        className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
      >
        <Icon name="x" size={22} />
      </button>

      {count > 1 && (
        <div className="absolute top-5 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-sm text-white/90">
          {index + 1} / {count}
        </div>
      )}

      {count > 1 && (
        <>
          <button
            onClick={(e) => { e.stopPropagation(); go(-1); }}
            title="Previous (←)"
            aria-label="Previous image"
            className="absolute left-3 top-1/2 z-10 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-3xl text-white transition hover:bg-white/20"
          >
            ‹
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); go(1); }}
            title="Next (→)"
            aria-label="Next image"
            className="absolute right-3 top-1/2 z-10 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-3xl text-white transition hover:bg-white/20"
          >
            ›
          </button>
        </>
      )}

      {/* Media — clicking it doesn't close the viewer; clicking around it does */}
      <div className="max-h-[86vh] max-w-[92vw]">
        {info.isVideo ? (
          <video
            key={info.url}
            src={info.url}
            controls
            autoPlay
            onLoadedMetadata={(e) => setSize({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })}
            className="max-h-[86vh] max-w-[92vw] rounded-sm"
          />
        ) : (
          <img
            key={info.url}
            src={info.url}
            alt={info.name}
            onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            className="max-h-[86vh] max-w-[92vw] rounded-sm object-contain"
          />
        )}
      </div>

      {/* The file: its size, and ways to keep it */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="absolute bottom-4 left-1/2 flex max-w-[92vw] -translate-x-1/2 items-center gap-3 rounded-full bg-black/60 px-4 py-1.5 text-sm text-white/90"
      >
        <span className="truncate" title={info.name}>{info.name}</span>
        {size && <span className="shrink-0 tabular-nums text-white/70" aria-label={`${size.w} by ${size.h} pixels`}>{size.w} × {size.h}</span>}
        <a href={info.url} download={info.name} className="flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 hover:bg-white/15" title="Download">
          <Icon name="download" size={16} />
          <span>Download</span>
        </a>
        <a href={info.url} target="_blank" rel="noopener noreferrer" className="flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 hover:bg-white/15" title="Open the original in a new tab">
          <Icon name="external" size={16} />
          <span>Open original</span>
        </a>
      </div>
    </Modal>
  );
}
