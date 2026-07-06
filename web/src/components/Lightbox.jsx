import { useEffect } from 'react';
import { attachmentInfo } from '../util.js';
import Icon from './Icon.jsx';

// Full-screen media viewer. Click the backdrop or ✕ to close (also Esc); the
// arrows / ← → keys move between items in the album.
export default function Lightbox({ items, index, onClose, onIndex }) {
  const count = items.length;
  const go = (delta) => onIndex((index + delta + count) % count);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' && count > 1) go(1);
      else if (e.key === 'ArrowLeft' && count > 1) go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, count]);

  const info = attachmentInfo(items[index]);
  if (!info) return null;

  return (
    <div
      className="anim-fade fixed inset-0 z-50 flex items-center justify-center bg-black/90"
      onClick={onClose}
    >
      {/* Close */}
      <button
        onClick={onClose}
        title="Close (Esc)"
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
            className="absolute left-3 top-1/2 z-10 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-3xl text-white transition hover:bg-white/20"
          >
            ‹
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); go(1); }}
            title="Next (→)"
            className="absolute right-3 top-1/2 z-10 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-3xl text-white transition hover:bg-white/20"
          >
            ›
          </button>
        </>
      )}

      {/* Media — clicking it should not close the overlay */}
      <div className="max-h-[92vh] max-w-[92vw]" onClick={(e) => e.stopPropagation()}>
        {info.isVideo ? (
          <video
            key={info.url}
            src={info.url}
            controls
            autoPlay
            className="max-h-[92vh] max-w-[92vw] rounded"
          />
        ) : (
          <img
            src={info.url}
            alt={info.name}
            className="max-h-[92vh] max-w-[92vw] rounded object-contain"
          />
        )}
      </div>
    </div>
  );
}
