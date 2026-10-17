import { describe, expect, test } from 'vitest';
import { mergeMessages, formatDay, applyServerOrder, roleRank, attachmentInfo, colorForName, avatarColor } from './util.js';

describe('mergeMessages', () => {
  test('adds new messages, replaces by id and keeps id order', () => {
    const existing = [{ id: 1, content: 'a' }, { id: 3, content: 'c' }];
    const incoming = [{ id: 2, content: 'b' }, { id: 3, content: 'c (edited)' }];
    expect(mergeMessages(existing, incoming)).toEqual([
      { id: 1, content: 'a' },
      { id: 2, content: 'b' },
      { id: 3, content: 'c (edited)' },
    ]);
  });

  test('ignores entries without an id', () => {
    expect(mergeMessages([{ id: 1 }], [null, { content: 'no id' }])).toEqual([{ id: 1 }]);
  });
});

describe('formatDay', () => {
  test('names today and yesterday', () => {
    expect(formatDay(Date.now())).toBe('Today');
    expect(formatDay(Date.now() - 24 * 60 * 60 * 1000)).toBe('Yesterday');
  });

  test('older dates get a full date; garbage gets nothing', () => {
    expect(formatDay(new Date(2025, 0, 2).getTime())).toMatch(/2025/);
    expect(formatDay('not a time')).toBe('');
  });
});

describe('applyServerOrder', () => {
  const list = [{ name: 'a' }, { name: 'b' }, { name: 'c' }];

  test('sorts by the saved order', () => {
    expect(applyServerOrder(list, ['c', 'a', 'b']).map((s) => s.name)).toEqual(['c', 'a', 'b']);
  });

  test('servers missing from the order go last, keeping their order', () => {
    expect(applyServerOrder(list, ['b']).map((s) => s.name)).toEqual(['b', 'a', 'c']);
  });

  test('no saved order leaves the list alone', () => {
    expect(applyServerOrder(list, [])).toBe(list);
  });
});

test('roleRank', () => {
  expect([roleRank('member'), roleRank('admin'), roleRank('owner'), roleRank(undefined)]).toEqual([1, 2, 3, 0]);
});

test('attachmentInfo recognises media and decodes names', () => {
  expect(attachmentInfo('/uploads/x/cat%20pic.PNG')).toMatchObject({ name: 'cat pic.PNG', ext: 'png', isImage: true, isMedia: true });
  expect(attachmentInfo('/uploads/x/notes.txt')).toMatchObject({ isImage: false, isVideo: false, isMedia: false });
});

describe('avatar colours', () => {
  // hsl(h s% l%) -> sRGB, then WCAG contrast against white.
  const hslToRgb = (h, s, l) => {
    s /= 100; l /= 100;
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    return [0, 8, 4].map((n) => 255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  };
  const lum = (rgb) => {
    const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
  };
  const whiteContrast = (css) => {
    const [h, s, l] = css.match(/hsl\((\d+) (\d+)% (\d+)%\)/).slice(1).map(Number);
    return 1.05 / (lum(hslToRgb(h, s, l)) + 0.05);
  };

  test('white initials reach WCAG AA (4.5:1) on every hue', () => {
    const failing = [];
    for (let hue = 0; hue < 360; hue++) {
      const r = whiteContrast(avatarColor(hue));
      if (r < 4.5) failing.push(`${hue}: ${r.toFixed(2)}`);
    }
    expect(failing).toEqual([]);
  });

  test('hues that already passed keep their exact colour', () => {
    // Blues and violets were fine at the old 45% lightness.
    expect(avatarColor(230)).toBe('hsl(230 45% 45%)');
    expect(avatarColor(270)).toBe('hsl(270 45% 45%)');
  });

  test('a name always gets the same colour', () => {
    expect(colorForName('sandy')).toBe(colorForName('sandy'));
    expect(colorForName('sandy')).toMatch(/^hsl\(\d+ 45% \d+%\)$/);
  });
});
