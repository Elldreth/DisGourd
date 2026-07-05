import { attachmentInfo } from '../util.js';

// Renders a message attachment from its stored URL: images preview inline,
// everything else shows as a downloadable file card.
export default function Attachment({ url }) {
  const info = attachmentInfo(url);
  if (!info) return null;

  if (info.isImage) {
    return (
      <a href={info.url} target="_blank" rel="noreferrer" className="mt-1 block w-fit">
        <img
          src={info.url}
          alt={info.name}
          loading="lazy"
          className="max-h-80 max-w-md rounded-lg border border-ink-500/50 object-contain"
        />
      </a>
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
      <div className="flex h-9 w-9 items-center justify-center rounded bg-brand/20 text-brand">📎</div>
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-brand">{info.name}</div>
        <div className="text-xs text-gray-400">Click to download</div>
      </div>
    </a>
  );
}
