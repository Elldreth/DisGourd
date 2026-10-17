// Link preview ("unfurl"): fetch a page safely and pull out its card fields
// from OpenGraph / Twitter tags, falling back to <title> and meta description.
// A small tokenizer, no DOM library; it never throws on bad HTML. The image
// URL is returned, not fetched.
//
//   unfurl(url, { fetcher?, ...safeFetchOptions })
//     -> { url, title, description, siteName, image, themeColor } | null

const { safeFetch } = require('../net/safeFetch');

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', copy: '©', reg: '®', trade: '™', laquo: '«', raquo: '»', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', middot: '·', bull: '•' };

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '';
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

// Collapse whitespace, drop control characters, decode entities.
const clean = (s) =>
  decodeEntities(String(s || ''))
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const cut = (s, max) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

// Attributes of one tag's source, e.g. ` property="og:title" content='x' a=b`.
function attrs(src) {
  const out = {};
  const re = /([^\s"'<>/=]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`]+)))?/g;
  let m;
  while ((m = re.exec(src))) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  return out;
}

// All <meta> name/property -> content pairs (first one wins), plus <title>.
function parseMeta(html) {
  const meta = {};
  const re = /<meta\b([^>]*)>/gi;
  let m;
  while ((m = re.exec(html))) {
    const a = attrs(m[1]);
    const key = (a.property || a.name || '').toLowerCase();
    if (key && a.content !== undefined && !(key in meta)) meta[key] = a.content;
  }
  const t = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (t) meta['<title>'] = t[1];
  return meta;
}

function absoluteHttpUrl(value, base) {
  if (!value) return null;
  try {
    const u = new URL(clean(value), base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

async function unfurl(url, { fetcher = safeFetch, ...fetchOptions } = {}) {
  let page;
  try {
    page = await fetcher(url, fetchOptions);
  } catch {
    return null; // refused or failed: no preview
  }
  if (!page || typeof page.body !== 'string') return null;

  const meta = parseMeta(page.body);
  const first = (...keys) => keys.map((k) => clean(meta[k])).find(Boolean) || '';
  const title = cut(first('og:title', 'twitter:title', '<title>'), 200);
  const description = cut(first('og:description', 'twitter:description', 'description'), 300);
  const image = absoluteHttpUrl(meta['og:image'] || meta['og:image:url'] || meta['og:image:secure_url'] || meta['twitter:image'] || meta['twitter:image:src'], page.url);
  if (!title && !description && !image) return null;

  const themeColor = clean(meta['theme-color']);
  return {
    url: page.url,
    title,
    description,
    siteName: cut(first('og:site_name', 'application-name'), 100),
    image,
    themeColor: /^#[0-9a-f]{3,8}$/i.test(themeColor) ? themeColor : null,
  };
}

module.exports = { unfurl, parseMeta, decodeEntities };
