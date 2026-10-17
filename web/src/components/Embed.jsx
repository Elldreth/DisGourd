import { useState } from 'react';

// A link-preview card under a message: site name, linked title, description and
// the page's image. The server fetched the page safely; the image loads from
// its own site (no referrer, lazily), and disappears if it fails.
const httpUrl = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : null);
const hexColor = (c) => (typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c) ? c : null);

export default function Embed({ embed }) {
  const [imageOk, setImageOk] = useState(true);
  const url = httpUrl(embed.url);
  const image = imageOk ? httpUrl(embed.image) : null;
  const color = hexColor(embed.themeColor);

  return (
    <article
      className="mt-1.5 max-w-md overflow-hidden rounded-lg border-l-4 border-ink-500 bg-ink-800/80 ring-1 ring-ink-500/40"
      style={color ? { borderLeftColor: color } : undefined}
    >
      <div className="p-3">
        {embed.siteName && <div className="mb-0.5 truncate text-xs text-gray-400">{embed.siteName}</div>}
        {embed.title &&
          (url ? (
            <a href={url} target="_blank" rel="noopener noreferrer nofollow ugc" className="line-clamp-2 font-semibold text-brand-hi hover:underline">
              {embed.title}
            </a>
          ) : (
            <div className="line-clamp-2 font-semibold text-gray-100">{embed.title}</div>
          ))}
        {embed.description && <p className="mt-1 line-clamp-3 text-sm text-gray-300">{embed.description}</p>}
        {image && (
          <img
            src={image}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setImageOk(false)}
            className="mt-2 max-h-64 w-full rounded-md object-cover"
          />
        )}
      </div>
    </article>
  );
}
