import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { renderHook } from '@testing-library/react';
import { attentionTitle, useDocumentAttention } from './attention.js';

describe('attentionTitle', () => {
  test('nothing waiting: just the name', () => {
    expect(attentionTitle('DisGourd', { mentions: 0, dms: 0, unread: 0 })).toBe('DisGourd');
    expect(attentionTitle('DisGourd', {})).toBe('DisGourd');
  });

  test('mentions and DMs are counted together', () => {
    expect(attentionTitle('DisGourd', { mentions: 1, dms: 0, unread: 4 })).toBe('(1) DisGourd');
    expect(attentionTitle('DisGourd', { mentions: 2, dms: 3, unread: 0 })).toBe('(5) DisGourd');
  });

  test('only plain unreads: a dot', () => {
    expect(attentionTitle('DisGourd', { mentions: 0, dms: 0, unread: 7 })).toBe('• DisGourd');
  });

  test('large counts are capped', () => {
    expect(attentionTitle('DisGourd', { mentions: 150, dms: 0, unread: 0 })).toBe('(99+) DisGourd');
  });
});

describe('useDocumentAttention', () => {
  let svgIcon;
  let pngIcon;
  let hrefWrites;

  beforeEach(() => {
    document.title = 'DisGourd';
    document.head.innerHTML = '';
    svgIcon = Object.assign(document.createElement('link'), { rel: 'icon', type: 'image/svg+xml' });
    svgIcon.setAttribute('href', '/favicon.svg');
    pngIcon = Object.assign(document.createElement('link'), { rel: 'icon', type: 'image/png' });
    pngIcon.setAttribute('href', '/favicon-32.png');
    document.head.append(svgIcon, pngIcon);
    hrefWrites = 0;
    new MutationObserver((records) => (hrefWrites += records.length)).observe(document.head, {
      attributes: true,
      subtree: true,
      attributeFilter: ['href'],
    });
  });

  afterEach(() => {
    document.head.innerHTML = '';
  });

  const flush = () => new Promise((r) => setTimeout(r, 0));

  test('a mention sets the count and the dot icon; reading it restores both', async () => {
    const { rerender } = renderHook((p) => useDocumentAttention(p), { initialProps: { mentions: 1, dms: 0, unread: 1 } });
    expect(document.title).toBe('(1) DisGourd');
    expect(svgIcon.getAttribute('href')).toBe('/favicon-dot.svg');
    expect(pngIcon.getAttribute('href')).toBe('/favicon-dot-32.png');

    rerender({ mentions: 0, dms: 0, unread: 0 });
    expect(document.title).toBe('DisGourd');
    expect(svgIcon.getAttribute('href')).toBe('/favicon.svg');
    expect(pngIcon.getAttribute('href')).toBe('/favicon-32.png');
  });

  test('plain unreads show the title dot but keep the normal icon', () => {
    renderHook(() => useDocumentAttention({ mentions: 0, dms: 0, unread: 3 }));
    expect(document.title).toBe('• DisGourd');
    expect(svgIcon.getAttribute('href')).toBe('/favicon.svg');
  });

  test('the icon is only touched when the dot state changes (no flicker)', async () => {
    const { rerender } = renderHook((p) => useDocumentAttention(p), { initialProps: { mentions: 1, dms: 0, unread: 0 } });
    await flush();
    const afterFirst = hrefWrites;
    rerender({ mentions: 2, dms: 1, unread: 5 }); // still has a dot
    rerender({ mentions: 3, dms: 1, unread: 5 });
    await flush();
    expect(hrefWrites).toBe(afterFirst);
    expect(document.title).toBe('(4) DisGourd');
  });

  test('unmounting restores the plain title and icon', () => {
    const { unmount } = renderHook(() => useDocumentAttention({ mentions: 2, dms: 0, unread: 0 }));
    unmount();
    expect(document.title).toBe('DisGourd');
    expect(svgIcon.getAttribute('href')).toBe('/favicon.svg');
  });
});
