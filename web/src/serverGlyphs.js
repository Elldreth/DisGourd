// Ready-made server icons (P8): twelve flat glyphs, white on a coloured tile,
// for servers without a picture. Picking one renders it to a PNG and uploads
// it like any icon, so the server and the rail need nothing new. The glyph
// markup is static and ours (never user input), drawn in a 48×48 box.
import { BODY_OUTER, BODY_INNER, LEAF } from './mascotParts.js';

const W = 'fill="#fff"';
const S = 'fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"';

export const SERVER_GLYPHS = [
  // The gourd mark itself, in white.
  { id: 'gourd', label: 'Gourd', bg: '#6f42e6', svg: `<g transform="translate(-0.5 -2.5) scale(0.5)"><path ${W} fill-rule="evenodd" d="${BODY_OUTER} ${BODY_INNER}"/><path ${W} d="${LEAF}"/></g>` },
  { id: 'game', label: 'Game controller', bg: '#2f5fd0', svg: `<path ${W} d="M14 15h20c5.5 0 9 4 10 10l1.5 9c.8 4.5-4 7-7 3.6L34 33H14l-4.5 4.6C6.5 41 1.7 38.5 2.5 34L4 25c1-6 4.5-10 10-10z"/><path fill="none" stroke="#2f5fd0" stroke-width="3" stroke-linecap="round" d="M14 20v8M10 24h8"/><circle cx="32" cy="21.5" r="2.2" fill="#2f5fd0"/><circle cx="36.5" cy="26" r="2.2" fill="#2f5fd0"/>` },
  { id: 'music', label: 'Music', bg: '#b8366a', svg: `<path ${W} d="M18 9l20-4v26.5a6 6 0 1 1-4-5.6V13.6l-12 2.4v20a6 6 0 1 1-4-5.6z"/>` },
  { id: 'book', label: 'Book', bg: '#13786b', svg: `<path ${S} d="M24 13c-4-3-10-4-17-3v26c7-1 13 0 17 3 4-3 10-4 17-3V10c-7-1-13 0-17 3zM24 13v26"/>` },
  { id: 'paw', label: 'Paw', bg: '#a8620c', svg: `<ellipse ${W} cx="12" cy="20" rx="4" ry="5"/><ellipse ${W} cx="20" cy="12" rx="4" ry="5"/><ellipse ${W} cx="28" cy="12" rx="4" ry="5"/><ellipse ${W} cx="36" cy="20" rx="4" ry="5"/><path ${W} d="M24 23c6 0 13 8 13 14 0 5-5 6-8 5-2.5-.7-3.5-1.2-5-1.2s-2.5.5-5 1.2c-3 1-8 0-8-5 0-6 7-14 13-14z"/>` },
  { id: 'leaf', label: 'Leaf', bg: '#3f7d20', svg: `<path ${W} d="M9 39C9 21 20 9 41 8c0 21-12 32-30 32z"/><path fill="none" stroke="#3f7d20" stroke-width="2.6" stroke-linecap="round" d="M11 37L32 16"/>` },
  { id: 'code', label: 'Code', bg: '#4338ca', svg: `<path ${S} d="M16 14L6 24l10 10M32 14l10 10-10 10M27 10l-6 28"/>` },
  { id: 'art', label: 'Art', bg: '#8a3fa8', svg: `<path ${W} fill-rule="evenodd" d="M24 6C12 6 5 14 5 23c0 10 8 18 17 18 3.5 0 4.5-2.5 3.5-4.5-1.3-2.6.5-5 3.3-5H34c5 0 9-3.5 9-9C43 13 35 6 24 6zM14 22.5a3 3 0 1 0 0-.1zM19 14a3 3 0 1 0 0-.1zM29 13a3 3 0 1 0 0-.1zM35 20a3 3 0 1 0 0-.1z"/>` },
  { id: 'rocket', label: 'Rocket', bg: '#1d6fa3', svg: `<path ${W} fill-rule="evenodd" d="M24 4c7 5 10 13 10 21l-3 9H17l-3-9c0-8 3-16 10-21zM24 16a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"/><path ${W} d="M14 25l-6 8 1 6 7-5zM34 25l6 8-1 6-7-5z"/><path ${W} d="M20 36h8l-2 8h-4z"/>` },
  { id: 'coffee', label: 'Coffee', bg: '#7a4a2a', svg: `<path ${W} d="M7 19h28v8c0 8-6 13-14 13S7 35 7 27z"/><path ${S} d="M35 22h3a5 5 0 0 1 0 10h-4M15 6c-2 3 2 5 0 8M23 6c-2 3 2 5 0 8"/>` },
  { id: 'film', label: 'Film', bg: '#4b4870', svg: `<path ${W} d="M6 20h36v18a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3z"/><path ${W} d="M6 12.5L39 6l1.5 7L7.5 19.5z"/><path fill="none" stroke="#4b4870" stroke-width="2.6" d="M15 11l4 6M25 9l4 6"/>` },
  { id: 'star', label: 'Star', bg: '#b23b3b', svg: `<path ${W} d="M24 5l5.6 12 13 1.4-9.8 8.8 2.8 12.9L24 33.5l-11.6 6.6 2.8-12.9-9.8-8.8 13-1.4z"/>` },
];

// The tile as standalone SVG markup (a rounded square, like the server rail's).
export function glyphTileSvg(glyph, size = 256) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 48 48"><rect width="48" height="48" fill="${glyph.bg}"/><g transform="translate(6 6) scale(0.75)">${glyph.svg}</g></svg>`;
}

// Render a glyph tile to a PNG File in the browser, ready to upload.
export function glyphToPng(glyph, size = 256) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      canvas.getContext('2d').drawImage(img, 0, 0, size, size);
      canvas.toBlob((blob) => (blob ? resolve(new File([blob], `${glyph.id}.png`, { type: 'image/png' })) : reject(new Error('Could not draw the icon'))), 'image/png');
    };
    img.onerror = () => reject(new Error('Could not draw the icon'));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(glyphTileSvg(glyph, size))}`;
  });
}
