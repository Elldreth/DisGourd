import { useEffect } from 'react';
import { attachmentInfo } from '../util.js';
import Icon from './Icon.jsx';
import Modal from './Modal.jsx';

// Full-screen media viewer (a Modal dialog). Click around the media or ✕ to
// close (also Esc); the arrows / ← → keys move between items in the album.
export default function Lightbox({ items, index, onClose, onIndex }) {
  const count = items.length;
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
      <div className="max-h-[92vh] max-w-[92vw]">
        {info.isVideo ? (
          <video
            key={info.url}
            src={info.url}
            controls
            autoPlay
            className="max-h-[92vh] max-w-[92vw] rounded-sm"
          />
        ) : (
          <img
            src={info.url}
            alt={info.name}
            className="max-h-[92vh] max-w-[92vw] rounded-sm object-contain"
          />
        )}
      </div>
    </Modal>
  );
}
