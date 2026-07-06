import { useState } from 'react';
import { attachmentInfo } from '../util.js';
import Icon from './Icon.jsx';

// Renders a message attachment. Images preview inline; other files show as a
// downloadable card. When `spoiler` is set the attachment is blurred behind a
// "click to reveal" overlay.
export default function Attachment({ url, spoiler }) {
  const info = attachmentInfo(url);
  const [revealed, setRevealed] = useState(!spoiler);
  if (!info) return null;

  if (info.isImage) {
    return (
      <div className="relative mt-1 w-fit overflow-hidden rounded-lg">
        <a
          href={info.url}
          target="_blank"
          rel="noreferrer"
          className={revealed ? 'block' : 'pointer-events-none block'}
          onClick={(e) => {
            if (!revealed) e.preventDefault();
          }}
        >
          <img
            src={info.url}
            alt={revealed ? info.name : 'Spoiler image'}
            loading="lazy"
            className={`max-h-80 max-w-md rounded-lg border border-ink-500/50 object-contain transition ${
              revealed ? '' : 'blur-2xl'
            }`}
          />
        </a>
        {!revealed && (
          <button
            onClick={() => setRevealed(true)}
            className="absolute inset-0 flex items-center justify-center bg-black/30"
          >
            <span className="rounded-full bg-black/70 px-3 py-1 text-sm font-semibold text-white">
              Spoiler · click to reveal
            </span>
          </button>
        )}
      </div>
    );
  }

  if (spoiler && !revealed) {
    return (
      <button
        onClick={() => setRevealed(true)}
        className="mt-1 flex w-fit items-center gap-3 rounded-lg border border-ink-500/50 bg-ink-800 px-3 py-2.5 text-left transition hover:border-brand"
      >
        <div className="flex h-9 w-9 items-center justify-center rounded bg-ink-600 text-gray-300"><Icon name="eyeOff" size={17} /></div>
        <div>
          <div className="text-sm font-medium text-gray-200">Spoiler attachment</div>
          <div className="text-xs text-gray-400">Click to reveal</div>
        </div>
      </button>
    );
  }

  return (
    <a
      href={info.url}
      target="_blank"
      rel="noreferrer"
      download={info.name}
      className="mt-1 flex w-fit max-w-md items-center gap-3 rounded-lg border border-ink-500/50 bg-ink-800 px-3 py-2.5 transition hover:border-brand"
    >
      <div className="flex h-9 w-9 items-center justify-center rounded bg-brand/20 text-brand"><Icon name="paperclip" size={17} /></div>
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-brand">{info.name}</div>
        <div className="text-xs text-gray-400">Click to download</div>
      </div>
    </a>
  );
}
