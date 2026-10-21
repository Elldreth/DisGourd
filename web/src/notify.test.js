import { describe, expect, test } from 'vitest';
import { attentionKind, shouldNotify, soundFor, notificationText, reportsRose } from './notify.js';

// Where you are and what you've chosen; tests override what they need.
const ctx = (over = {}) => ({
  me: 'sandy',
  focused: true,
  view: 'server',
  space: 'Home',
  channel: 'general',
  dm: '',
  level: 'mentions',
  sounds: true,
  ...over,
});
const msg = (over = {}) => ({ kind: 'message', author: 'bob', space: 'Home', channel: 'random', mentions: [], ...over });
const dmFrame = (over = {}) => ({ kind: 'dm', from: 'bob', to: 'sandy', ...over });

describe('attentionKind', () => {
  test('your own messages and DMs never need attention', () => {
    expect(attentionKind(msg({ author: 'sandy', mentions: ['sandy'] }), ctx())).toBeNull();
    expect(attentionKind(dmFrame({ from: 'sandy', to: 'bob' }), ctx())).toBeNull();
  });

  test('a mention, a DM and a plain message elsewhere', () => {
    expect(attentionKind(msg({ mentions: ['sandy'] }), ctx())).toBe('mention');
    expect(attentionKind(dmFrame(), ctx())).toBe('dm');
    expect(attentionKind(msg(), ctx())).toBe('message');
  });

  test('nothing for the channel or DM you are looking at with the window focused', () => {
    expect(attentionKind(msg({ channel: 'general', mentions: ['sandy'] }), ctx())).toBeNull();
    // P9-06b: the open DM is a conversation key.
    expect(attentionKind(dmFrame({ conversation: 7 }), ctx({ view: 'dm', dm: 'c:7' }))).toBeNull();
    expect(attentionKind(dmFrame({ conversation: 8 }), ctx({ view: 'dm', dm: 'c:7' }))).toBe('dm');
    expect(attentionKind(dmFrame(), ctx({ view: 'dm', dm: '@bob' }))).toBeNull(); // a frame without one: by sender
  });

  test('the open channel still counts when the window is in the background', () => {
    expect(attentionKind(msg({ channel: 'general', mentions: ['sandy'] }), ctx({ focused: false }))).toBe('mention');
    expect(attentionKind(dmFrame(), ctx({ view: 'dm', dm: 'bob', focused: false }))).toBe('dm');
  });

  test('a channel with the same name in DM view, or another server, is not "looking"', () => {
    expect(attentionKind(msg({ channel: 'general' }), ctx({ view: 'dm', dm: 'cara' }))).toBe('message');
    expect(attentionKind(msg({ space: 'Other', channel: 'general' }), ctx())).toBe('message');
  });
});

describe('shouldNotify follows the level', () => {
  test('off: never', () => {
    expect(shouldNotify(msg({ mentions: ['sandy'] }), ctx({ level: 'off' }))).toBeNull();
    expect(shouldNotify(dmFrame(), ctx({ level: 'off' }))).toBeNull();
  });

  test('mentions & DMs: those two only', () => {
    expect(shouldNotify(msg({ mentions: ['sandy'] }), ctx())).toBe('mention');
    expect(shouldNotify(dmFrame(), ctx())).toBe('dm');
    expect(shouldNotify(msg(), ctx())).toBeNull();
  });

  test('all messages: plain messages too, but still not your own or the one you are reading', () => {
    expect(shouldNotify(msg(), ctx({ level: 'all' }))).toBe('message');
    expect(shouldNotify(msg({ author: 'sandy' }), ctx({ level: 'all' }))).toBeNull();
    expect(shouldNotify(msg({ channel: 'general' }), ctx({ level: 'all' }))).toBeNull();
  });
});

describe('soundFor', () => {
  test('mentions and DMs chime; plain messages only blip at the "all" level', () => {
    expect(soundFor(msg({ mentions: ['sandy'] }), ctx())).toBe('mention');
    expect(soundFor(dmFrame(), ctx())).toBe('mention');
    expect(soundFor(msg(), ctx())).toBeNull();
    expect(soundFor(msg(), ctx({ level: 'all' }))).toBe('message');
  });

  test('sounds off, your own message, or the open conversation: silent', () => {
    expect(soundFor(msg({ mentions: ['sandy'] }), ctx({ sounds: false }))).toBeNull();
    expect(soundFor(msg({ author: 'sandy', mentions: ['sandy'] }), ctx())).toBeNull();
    expect(soundFor(msg({ channel: 'general', mentions: ['sandy'] }), ctx())).toBeNull();
  });

  test('sounds work even with notifications off', () => {
    expect(soundFor(dmFrame(), ctx({ level: 'off' }))).toBe('mention');
  });
});

describe('notificationText', () => {
  test('strips markdown and hides spoilers', () => {
    expect(notificationText('**big** news: ||the twist|| `code` ~~old~~ __u__ _i_')).toBe('big news: Spoiler code old u i');
  });

  test('summarises code blocks and attachments', () => {
    expect(notificationText('look\n```js\nconst a = 1;\n```')).toBe('look [code]');
    expect(notificationText('', ['/uploads/x/cat.png'])).toBe('Sent an attachment');
    expect(notificationText('pics', ['/a', '/b'])).toBe('pics (2 attachments)');
  });

  test('truncates to 120 characters', () => {
    const out = notificationText('a'.repeat(300));
    expect(out.length).toBe(120);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('Do Not Disturb (P2-14)', () => {
  test('no desktop notifications and no sounds, even for mentions and DMs', () => {
    const dnd = ctx({ dnd: true, level: 'all', focused: false });
    expect(shouldNotify(msg({ mentions: ['sandy'] }), dnd)).toBeNull();
    expect(shouldNotify(dmFrame(), dnd)).toBeNull();
    expect(soundFor(msg({ mentions: ['sandy'] }), dnd)).toBeNull();
    expect(soundFor(dmFrame(), dnd)).toBeNull();
    // ...and everything comes back when it's off.
    expect(shouldNotify(dmFrame(), ctx({ level: 'all', focused: false }))).toBe('dm');
  });
});

describe('threads (P2-22c)', () => {
  const inThread = (over = {}) => msg({ channel: '~t5', thread: { name: 'Weekend plans', parentChannel: 'general' }, ...over });
  test('a reply in the thread open in the panel is "looking" while the window is focused', () => {
    expect(attentionKind(inThread(), ctx({ thread: '~t5' }))).toBeNull();
    expect(attentionKind(inThread(), ctx({ thread: '~t5', focused: false }))).toBe('message');
    expect(attentionKind(inThread(), ctx({ thread: '~t6' }))).toBe('message');
    expect(attentionKind(inThread({ mentions: ['sandy'] }), ctx())).toBe('mention');
  });
  test('the title names the thread and its channel', async () => {
    const { notificationPlace } = await import('./notify.js');
    expect(notificationPlace(inThread())).toBe('Weekend plans (#general) · Home');
    expect(notificationPlace(msg())).toBe('#random · Home');
  });
});

describe('reportsRose (P10-08)', () => {
  const spaces = (a, b) => [{ name: 'A', openReports: a }, { name: 'B', openReports: b }];
  test('only a rise in a server already seen counts', () => {
    expect(reportsRose(null, spaces(3, 0))).toBe(false); // the first look (signing in)
    expect(reportsRose({ A: 3, B: 0 }, spaces(3, 0))).toBe(false);
    expect(reportsRose({ A: 3, B: 0 }, spaces(2, 0))).toBe(false); // one was handled
    expect(reportsRose({ A: 3, B: 0 }, spaces(3, 1))).toBe(true);
    expect(reportsRose({ A: 3 }, spaces(3, 4))).toBe(false); // B is new to us (joined, or a reload)
  });
});
