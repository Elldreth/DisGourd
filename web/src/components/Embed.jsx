import { useState } from 'react';

// A link-preview card under a message: site name, linked title, description and
// the page's image. The server fetched the page safely and normally serves the
// image itself (/media/preview/…, so the site never sees viewers); with the
// proxy off it's a direct https link. No referrer, lazy, gone if it fails.
const httpUrl = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : null);
const imageUrl = (u) => (typeof u === 'string' && /^\/media\/preview\/[\w-]+\/[\w-]+$/.test(u) ? u : httpUrl(u));
const hexColor = (c) => (typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c) ? c : null);

// Shape of the card's image, known once it has loaded: a wide picture is a
// banner under the text (capped at 176px tall so one card never fills a
// screen); a small or square one is a 72px thumbnail beside the text.
function shapeFor(width, height) {
  if (!width || !height) return 'banner';
  return width < 300 || width / height < 1.4 ? 'thumb' : 'banner';
}

// `onHide` (optional): shows a × that removes the message's link cards (P3-20c).
export default function Embed({ embed, onHide }) {
  const [imageOk, setImageOk] = useState(true);
  const [shape, setShape] = useState('banner');
  const url = httpUrl(embed.url);
  const image = imageOk ? imageUrl(embed.image) : null;
  const color = hexColor(embed.themeColor);
  const thumb = image && shape === 'thumb';

  return (
    <article
      className="group/embed relative mt-1.5 max-w-[420px] overflow-hidden rounded-lg border-l-4 border-ink-500 bg-ink-800/80 ring-1 ring-ink-500/40"
      style={color ? { borderLeftColor: color } : undefined}
    >
      {onHide && (
        <button
          type="button"
          onClick={onHide}
          aria-label="Remove preview"
          title="Remove preview"
          className="absolute right-1 top-1 z-10 rounded-sm bg-ink-900/80 px-1.5 text-sm leading-6 text-gray-300 opacity-0 transition hover:text-fg focus-visible:opacity-100 group-hover/embed:opacity-100 coarse:opacity-100"
        >
          ×
        </button>
      )}
      <div className={`p-3 ${thumb ? 'flex items-start gap-3' : ''}`}>
        <div className="min-w-0 flex-1">
        {embed.siteName && <div className="mb-0.5 truncate text-xs text-gray-400">{embed.siteName}</div>}
        {embed.title &&
          (url ? (
            <a href={url} target="_blank" rel="noopener noreferrer nofollow ugc" className="line-clamp-2 font-semibold text-brand-hi hover:underline">
              {embed.title}
            </a>
          ) : (
            <div className="line-clamp-2 font-semibold text-gray-100">{embed.title}</div>
          ))}
        {embed.description && <p className="mt-1 line-clamp-2 text-sm text-gray-300">{embed.description}</p>}
        </div>
        {image && (
          <img
            src={image}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setImageOk(false)}
            onLoad={(e) => setShape(shapeFor(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight))}
            className={thumb ? 'size-18 shrink-0 rounded-md object-cover' : 'mt-2 max-h-44 w-full rounded-md object-cover'}
          />
        )}
      </div>
    </article>
  );
}
