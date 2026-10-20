import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { computeAccessibleName } from 'dom-accessibility-api';

// P4-06: the ten small hierarchy and accessibility items from the October
// 2026 UX review (V4, F6, V5, V6, V8, A2, A3, A4, V2, V7).

vi.mock('../api.js', () => ({
  getMessages: vi.fn(),
  previewInvite: vi.fn(async () => ({ space: 'S', members: 1, alreadyMember: false })),
}));
vi.mock('../audio.js', async (orig) => ({ ...(await orig()), displayCaptureSupported: () => true }));

const { default: ServerRail } = await import('./ServerRail.jsx');
const { default: ChannelList } = await import('./ChannelList.jsx');
const { default: DmSidebar } = await import('./DmSidebar.jsx');
const { default: MessageList } = await import('./MessageList.jsx');
const { default: ThreadPanel } = await import('./ThreadPanel.jsx');
const { default: AudioSettings } = await import('./AudioSettings.jsx');
const { default: AuthShell } = await import('./AuthShell.jsx');
const { default: Gourd } = await import('./Gourd.jsx');

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

const T = new Date('2026-10-16T14:00:00').getTime();
const msg = (id, author = 'bob') => ({ id, author, content: `message ${id}`, timestamp: T + id * 1000 });

// V4 + A3: the rail groups home / servers / actions, and names the app once.
test('server rail: a heading for the app, separators between the groups, outlined action buttons', () => {
  render(<ServerRail spaces={[{ name: 'Tx Check' }]} currentSpace="Tx Check" onSelect={() => {}} onCreate={() => {}} onJoin={() => {}} onSelectDms={() => {}} />);
  const h1 = screen.getByRole('heading', { level: 1, name: 'DisGourd' });
  expect(h1.className).toContain('sr-only');
  expect(screen.getAllByRole('separator')).toHaveLength(2);
  for (const name of ['Create a server', 'Join a server with an invite']) {
    const b = screen.getByRole('button', { name });
    expect(b.className, name).toMatch(/\bring-2\b/);
    expect(b.className, name).not.toMatch(/\bbg-ink-700\b/);
  }
  // A server tile stays filled.
  expect(screen.getByRole('button', { name: 'Tx Check' }).className).not.toMatch(/\bring-2\b/);
});

// A3: the sidebars are landmarks.
test('channel list and DM list are navigation landmarks', () => {
  render(
    <ChannelList space="S" channels={['general']} currentChannel="general" voiceChannels={[]} voiceParticipants={{}} activeVoiceParticipants={[]} user="sandy" status="open" selfId={1} onSelect={() => {}} />
  );
  expect(screen.getByRole('navigation', { name: 'Channels' })).toBeTruthy();
  cleanup();
  render(<DmSidebar conversations={[]} user="sandy" status="open" onSelect={() => {}} />);
  expect(screen.getByRole('navigation', { name: 'Direct messages' })).toBeTruthy();
});

// F6, then P5-04: the menu is short; a separator sets Server settings apart,
// and Delete server lives in Server settings › Overview's danger zone.
test('server menu: a separator before Server settings, and no Delete server in the menu', () => {
  render(
    <ChannelList space="S" channels={['general']} currentChannel="general" voiceChannels={[]} voiceParticipants={{}} activeVoiceParticipants={[]} user="sandy" status="open" selfId={1} onSelect={() => {}} canManage isOwner role="owner" onInvite={() => {}} />
  );
  fireEvent.click(screen.getByRole('button', { name: /^S$|S$/ }));
  expect(screen.queryByRole('button', { name: /Delete server/ })).toBeNull();
  const settings = screen.getByRole('button', { name: /Server settings/ });
  expect(settings.previousElementSibling.getAttribute('role')).toBe('separator');
});

// V5: grouped-message timestamps are readable, and always shown on touch.
test('grouped message timestamps are 11px, one step brighter, and shown without hover on coarse pointers', () => {
  render(<MessageList messages={[msg(1), msg(2)]} channel="general" currentUser="sandy" />);
  const rows = screen.getAllByRole('article');
  const time = rows[1].querySelector('span.whitespace-nowrap');
  expect(time.textContent).toMatch(/\d/);
  expect(time.className).toMatch(/text-\[11px\]/);
  expect(time.className).toMatch(/\btext-gray-400\b/);
  expect(time.className).toMatch(/\bcoarse:block\b/);
  expect(time.className).not.toMatch(/text-\[10px\]/);
});

// V2: the thread chip keeps the name and drops the trailing meta first.
test('thread chip: the name gets the flexible width and "last …" hides on narrow screens', () => {
  const thread = { channel: '~t2', name: 'Weekend plans', messageCount: 2, lastActivityAt: T };
  render(<MessageList messages={[{ ...msg(2), thread }]} channel="general" currentUser="sandy" onOpenThread={() => {}} />);
  const chip = screen.getByRole('button', { name: /Open thread Weekend plans/ });
  const name = [...chip.querySelectorAll('span')].find((s) => s.textContent === 'Weekend plans');
  expect(name.className).toMatch(/\bmin-w-0\b/);
  expect(name.className).toMatch(/\bflex-1\b/);
  const last = [...chip.querySelectorAll('span')].find((s) => /^· last /.test(s.textContent.trim()));
  expect(last.className).toMatch(/max-\[360px\]:hidden/);
  const count = [...chip.querySelectorAll('span')].find((s) => /2 replies/.test(s.textContent));
  expect(count.className).toMatch(/\bshrink-0\b/);
});

// V8: the thread panel reads top-down and says who started it.
test('thread panel: replies start at the top and the root says who started the thread', () => {
  const root = { id: 7, author: 'bob', content: 'Plans?', timestamp: T };
  const thread = { space: 'S', parentChannel: 'general', channel: '~t7', name: 'Weekend plans', rootMessageId: 7, root };
  render(<ThreadPanel space="S" thread={thread} status="open" messages={[]} currentUser="sandy" onSend={() => {}} onClose={() => {}} />);
  expect(screen.getByText(/Started by bob/)).toBeTruthy();
  const list = screen.getByRole('log', { name: 'Replies in thread Weekend plans' });
  expect(list.querySelector('.justify-end')).toBeNull();
  expect(list.querySelector('[data-icon="thread"]')).toBeTruthy();
  expect(list.querySelector('[data-icon="hash"]')).toBeNull();
});

// A2: every control in the audio settings has the name its caption shows.
test('audio settings: selects and checkboxes are named by their captions', () => {
  render(<AudioSettings />);
  const names = [...document.querySelectorAll('select, input[type=checkbox]')].map((el) => computeAccessibleName(el));
  expect(names.filter((n) => /^Microphone/.test(n))).toHaveLength(1);
  expect(names.filter((n) => /^Speaker/.test(n))).toHaveLength(1);
  expect(names.filter((n) => /^Join\/leave sounds/.test(n))).toHaveLength(1);
  expect(names.filter((n) => /^Push-to-talk/.test(n))).toHaveLength(1);
});

// V6: one outline on the auth card, not three.
test('auth card: the logo tile has no ring of its own', () => {
  render(<AuthShell title="Welcome" subtitle="Sign in"><p>form</p></AuthShell>);
  const tile = screen.getByRole('heading', { name: 'Welcome' }).previousElementSibling;
  expect(tile.querySelector('svg')).toBeTruthy();
  expect(tile.className).not.toMatch(/\bring-1\b/);
  expect(tile.className).not.toMatch(/\bbg-ink-900\b/);
});

// V7: the leaf follows the theme's lime, so the light theme's darker lime applies.
test('gourd: the leaf takes its colour from the theme unless a colour is passed', () => {
  const { container, rerender } = render(<Gourd size={56} />);
  const paths = container.querySelectorAll('path');
  expect(paths[paths.length - 1].getAttribute('fill')).toBe('var(--color-lime)');
  expect(paths[0].getAttribute('fill')).toBe('var(--color-brand-logo)');
  rerender(<Gourd size={56} color="currentColor" />);
  const mono = container.querySelectorAll('path');
  expect(mono[mono.length - 1].getAttribute('fill')).toBe('currentColor');
});
