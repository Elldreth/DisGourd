// The browser tab shows what's waiting: "(N) DisGourd" for mentions + unread
// DMs, "• DisGourd" when there are only ordinary unread messages, and a pink
// dot on the favicon whenever N > 0.
import { useEffect } from 'react';

const BASE_TITLE = 'DisGourd';

// The plain and "has a dot" versions of each favicon link (see web/public).
const ICONS = {
  'image/svg+xml': { plain: '/favicon.svg', dot: '/favicon-dot.svg' },
  'image/png': { plain: '/favicon-32.png', dot: '/favicon-dot-32.png' },
};

export function attentionTitle(base, { mentions = 0, dms = 0, unread = 0 } = {}) {
  const n = mentions + dms;
  if (n > 0) return `(${n > 99 ? '99+' : n}) ${base}`;
  if (unread > 0) return `• ${base}`;
  return base;
}

function setFaviconDot(on) {
  for (const link of document.querySelectorAll('link[rel~="icon"]')) {
    const icon = ICONS[link.getAttribute('type')];
    if (!icon) continue;
    const href = on ? icon.dot : icon.plain;
    if (link.getAttribute('href') !== href) link.setAttribute('href', href);
  }
}

export function useDocumentAttention({ mentions = 0, dms = 0, unread = 0 }) {
  const title = attentionTitle(BASE_TITLE, { mentions, dms, unread });
  const dot = mentions + dms > 0;

  useEffect(() => {
    document.title = title;
  }, [title]);

  // Only when the dot turns on or off, so changing counts never flicker the icon.
  useEffect(() => {
    setFaviconDot(dot);
  }, [dot]);

  // Leave a clean tab behind (on sign-out the app unmounts this).
  useEffect(
    () => () => {
      document.title = BASE_TITLE;
      setFaviconDot(false);
    },
    []
  );
}
