import { useState } from 'react';
import { attachmentInfo } from '../util.js';
import Attachment from './Attachment.jsx';
import Lightbox from './Lightbox.jsx';

// A single image (click to open) or an inline video player.
function SingleMedia({ info, onOpen }) {
  if (info.isVideo) {
    return (
      <video
        src={info.url}
        controls
        preload="metadata"
        className="max-h-80 max-w-md rounded-lg border border-ink-500/50"
      />
    );
  }
  return (
    <button onClick={onOpen} title="View" className="block">
      <img
        src={info.url}
        alt={info.name}
        loading="lazy"
        className="max-h-80 max-w-md rounded-lg border border-ink-500/50 object-contain"
      />
    </button>
  );
}

// A thumbnail grid for 2+ media items; the last tile shows "+N" when there are
// more than fit. Any tile opens the lightbox at that position.
function Grid({ media, onOpen }) {
  const limit = media.length <= 4 ? 4 : 6;
  const shown = media.slice(0, limit);
  const extra = media.length - shown.length;
  const cols = media.length <= 4 ? 'grid-cols-2' : 'grid-cols-3';
  return (
    <div className={`grid ${cols} w-fit max-w-md gap-1`}>
      {shown.map((info, i) => {
        const isLast = i === shown.length - 1 && extra > 0;
        return (
          <button
            key={info.url}
            onClick={() => onOpen(i)}
            className="relative aspect-square overflow-hidden rounded-md bg-black"
          >
            {info.isVideo ? (
              <>
                <video src={info.url} muted preload="metadata" className="h-full w-full object-cover" />
                <span className="absolute inset-0 flex items-center justify-center text-3xl text-white/90 drop-shadow">▶</span>
              </>
            ) : (
              <img src={info.url} alt={info.name} loading="lazy" className="h-full w-full object-cover" />
            )}
            {isLast && (
              <span className="absolute inset-0 flex items-center justify-center bg-black/60 text-xl font-semibold text-white">
                +{extra}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// Renders a message's attachments: media (images/videos) as a single view or a
// clickable thumbnail grid opening a full-screen lightbox, and any non-media
// files as download cards. A single spoiler flag blurs the whole set.
export default function Album({ items, spoiler }) {
  const [revealed, setRevealed] = useState(!spoiler);
  const [lightbox, setLightbox] = useState(-1); // index into media, or -1 = closed

  const infos = (items || []).map(attachmentInfo).filter(Boolean);
  if (infos.length === 0) return null;
  const media = infos.filter((i) => i.isMedia);
  const files = infos.filter((i) => !i.isMedia);
  const mediaUrls = media.map((i) => i.url);

  const content = (
    <div className="mt-1 space-y-1">
      {media.length === 1 && <SingleMedia info={media[0]} onOpen={() => setLightbox(0)} />}
      {media.length >= 2 && <Grid media={media} onOpen={(i) => setLightbox(i)} />}
      {files.map((info) => (
        <Attachment key={info.url} url={info.url} spoiler={false} />
      ))}
    </div>
  );

  return (
    <>
      {spoiler && !revealed ? (
        <div className="relative mt-1 w-fit">
          <div className="pointer-events-none blur-2xl">{content}</div>
          <button
            onClick={() => setRevealed(true)}
            className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/30"
          >
            <span className="rounded-full bg-black/70 px-3 py-1 text-sm font-semibold text-white">
              Spoiler · click to reveal
            </span>
          </button>
        </div>
      ) : (
        content
      )}
      {lightbox >= 0 && media.length > 0 && (
        <Lightbox
          items={mediaUrls}
          index={Math.min(lightbox, mediaUrls.length - 1)}
          onClose={() => setLightbox(-1)}
          onIndex={setLightbox}
        />
      )}
    </>
  );
}
