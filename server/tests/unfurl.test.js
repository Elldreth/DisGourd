const http = require('http');
const { unfurl, parseMeta } = require('../integrations/unfurl');

const FIXTURE = `<!doctype html>
<html><head>
  <meta charset="utf-8">
  <title>Fallback &amp; title</title>
  <meta name="description" content="Plain description">
  <meta property="og:title" content="Tom &amp; Jerry&#39;s &quot;Big&quot; Day &#x2014; Live">
  <meta property="og:description" content="A &lt;great&gt; day out">
  <meta property="og:site_name" content="Cartoon&nbsp;Net">
  <meta content="/img/card.png" property="og:image">
  <meta name="theme-color" content="#7c3aed">
</head><body><p>ignored</p></body></html>`;

const page = (html, url = 'https://news.example/articles/1') => async () => ({ url, status: 200, contentType: 'text/html', body: html });

test('OpenGraph fields win; entities are decoded; a relative image resolves against the page', async () => {
  const card = await unfurl('https://news.example/a', { fetcher: page(FIXTURE) });
  expect(card).toEqual({
    url: 'https://news.example/articles/1',
    title: 'Tom & Jerry\'s "Big" Day — Live',
    description: 'A <great> day out',
    siteName: 'Cartoon Net',
    image: 'https://news.example/img/card.png',
    themeColor: '#7c3aed',
  });
});

test('falls back to twitter:*, then <title> and meta description', async () => {
  const twitter = '<meta name="twitter:title" content="From Twitter"><meta name="twitter:image" content="https://cdn.example/t.jpg">';
  expect(await unfurl('https://x.example', { fetcher: page(twitter) })).toMatchObject({ title: 'From Twitter', image: 'https://cdn.example/t.jpg' });
  const plain = "<title>\n  Just a  title </title><meta name='description' content='Plain'>";
  expect(await unfurl('https://x.example', { fetcher: page(plain) })).toMatchObject({ title: 'Just a title', description: 'Plain', image: null });
});

test('long text is cut to 200 / 300 characters', async () => {
  const html = `<meta property="og:title" content="${'t'.repeat(500)}"><meta property="og:description" content="${'d'.repeat(900)}">`;
  const card = await unfurl('https://x.example', { fetcher: page(html) });
  expect(card.title.length).toBe(200);
  expect(card.title.endsWith('…')).toBe(true);
  expect(card.description.length).toBe(300);
});

test('only http(s) images are kept', async () => {
  for (const img of ['javascript:alert(1)', 'data:image/png;base64,AAAA', 'file:///etc/passwd']) {
    const card = await unfurl('https://x.example', { fetcher: page(`<title>t</title><meta property="og:image" content="${img}">`) });
    expect(card.image).toBeNull();
  }
});

test('malformed HTML does not throw', async () => {
  const broken = ['<meta property="og:title" content="unterminated', '<title>no end', '<<<meta>>>', '<meta property=og:title content=Bare>', '\u0000￿', ''];
  for (const html of broken) {
    await expect(unfurl('https://x.example', { fetcher: page(html) })).resolves.toBeDefined();
  }
  expect(parseMeta('<meta property=og:title content=Bare>')['og:title']).toBe('Bare');
});

test('nothing useful, a failed fetch, or a non-HTML page gives null', async () => {
  expect(await unfurl('https://x.example', { fetcher: page('<p>no metadata</p>') })).toBeNull();
  expect(await unfurl('https://x.example', { fetcher: async () => null })).toBeNull();
  expect(
    await unfurl('https://x.example', {
      fetcher: async () => {
        throw Object.assign(new Error('nope'), { code: 'BLOCKED_ADDRESS' });
      },
    })
  ).toBeNull();
});

test('end to end through the safe fetcher (local server)', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(FIXTURE);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const url = `http://127.0.0.1:${server.address().port}/post`;
    const card = await unfurl(url, { allowLoopback: true });
    expect(card).toMatchObject({ url, siteName: 'Cartoon Net', image: `http://127.0.0.1:${server.address().port}/img/card.png` });
    expect(await unfurl(url)).toBeNull(); // without the test switch, loopback is refused
  } finally {
    server.close();
  }
});
