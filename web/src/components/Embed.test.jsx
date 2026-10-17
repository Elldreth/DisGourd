import { afterEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import Embed from './Embed.jsx';

afterEach(cleanup);

// The image is decorative (alt="": the title already names the card), so it
// has no "img" role; find the element itself.
const img = () => document.querySelector('article img');

const card = {
  url: 'https://news.example/story',
  title: 'A big story',
  description: 'What happened today',
  siteName: 'News Example',
  image: 'https://cdn.example/story.jpg',
  themeColor: '#ff6600',
};

test('a card with the site, a linked title, the description and the image', () => {
  render(<Embed embed={card} />);
  const link = screen.getByRole('link', { name: 'A big story' });
  expect(link.getAttribute('href')).toBe(card.url);
  expect(link.getAttribute('target')).toBe('_blank');
  expect(link.getAttribute('rel')).toBe('noopener noreferrer nofollow ugc');
  expect(screen.getByText('News Example')).toBeTruthy();
  expect(screen.getByText('What happened today')).toBeTruthy();
  expect(img().getAttribute('src')).toBe(card.image);
  expect(img().getAttribute('alt')).toBe('');
  expect(img().getAttribute('referrerpolicy')).toBe('no-referrer'); // the site doesn't learn which chat it was in
  expect(img().getAttribute('loading')).toBe('lazy');
  expect(screen.getByRole('article').style.borderLeftColor).toBe('rgb(255, 102, 0)');
});

test('a broken image just disappears', () => {
  render(<Embed embed={card} />);
  fireEvent.error(img());
  expect(img()).toBeNull();
  expect(screen.getByRole('link', { name: 'A big story' })).toBeTruthy();
});

test('unsafe links, images and colours are never used', () => {
  render(<Embed embed={{ ...card, url: 'javascript:alert(1)', image: 'data:image/png;base64,AA', themeColor: 'red;background:url(x)' }} />);
  expect(screen.queryByRole('link')).toBeNull();
  expect(screen.getByText('A big story')).toBeTruthy(); // still shown, just not a link
  expect(img()).toBeNull();
  expect(screen.getByRole('article').style.borderLeftColor).toBe('');
});

test('a card with only a title still renders, without empty parts', () => {
  render(<Embed embed={{ url: 'https://x.example/', title: 'Only a title' }} />);
  expect(screen.getByRole('link', { name: 'Only a title' })).toBeTruthy();
  expect(img()).toBeNull();
});

test('an image served by our own proxy is used (a same-origin /media/preview path)', () => {
  render(<Embed embed={{ ...card, image: '/media/preview/abcDEF_-123/aHR0cHM6Ly9jZG4uZXhhbXBsZS9zLmpwZw' }} />);
  expect(img().getAttribute('src')).toBe('/media/preview/abcDEF_-123/aHR0cHM6Ly9jZG4uZXhhbXBsZS9zLmpwZw');
});

test('other relative or odd paths are still refused', () => {
  for (const bad of ['/uploads/x.png', '/media/preview/../../etc', '//evil.example/x.png']) {
    cleanup();
    render(<Embed embed={{ ...card, image: bad }} />);
    expect(img()).toBeNull();
  }
});

// P4-05: calmer cards. The card is capped at 420px, a banner image at 176px
// tall, and a small or square image becomes a 72px thumbnail beside the text
// instead of a banner. The shape is decided once the image has loaded.
function loadImage(el, width, height) {
  Object.defineProperty(el, 'naturalWidth', { value: width, configurable: true });
  Object.defineProperty(el, 'naturalHeight', { value: height, configurable: true });
  fireEvent.load(el);
}

test('the card is capped at 420px and a banner image at 176px tall', () => {
  render(<Embed embed={card} />);
  const article = screen.getByRole('article');
  expect(article.className).toMatch(/max-w-\[420px\]/);
  expect(article.className).not.toMatch(/\bmax-w-md\b/);
  loadImage(img(), 1200, 600);
  expect(img().className).toMatch(/\bmax-h-44\b/);
  expect(img().className).toMatch(/\bobject-cover\b/);
  expect(img().className).not.toMatch(/\bsize-18\b/);
});

test('a square or small image becomes a thumbnail beside the text', () => {
  render(<Embed embed={card} />);
  loadImage(img(), 400, 400);
  expect(img().className).toMatch(/\bsize-18\b/);
  expect(img().className).not.toMatch(/\bmax-h-44\b/);
  // The thumbnail sits in a row with the text, after it.
  const row = img().parentElement;
  expect(row.className).toMatch(/\bflex\b/);
  expect(row.lastElementChild).toBe(img());
  expect(screen.getByRole('link', { name: 'A big story' })).toBeTruthy();
  cleanup();
  render(<Embed embed={card} />);
  loadImage(img(), 240, 100); // wide but tiny: still a thumbnail
  expect(img().className).toMatch(/\bsize-18\b/);
});
