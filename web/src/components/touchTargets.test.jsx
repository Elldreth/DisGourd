import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

// P4-01: phone touch targets. Desktop keeps its sizes; on coarse pointers the
// `tap*` utilities (index.css) enlarge the hit areas. jsdom has no layout, so
// these tests check the classes and the phone-only More menu, and the sandbox
// measurement in the packet checks the real sizes.

vi.mock('../api.js', () => ({ getPins: vi.fn(async () => []), getThreads: vi.fn(async () => []), createThread: vi.fn() }));
vi.mock('../audio.js', async (orig) => ({ ...(await orig()), displayCaptureSupported: () => true }));

const { default: ChatPanel } = await import('./ChatPanel.jsx');
const { default: ChannelList } = await import('./ChannelList.jsx');
const { default: DmSidebar } = await import('./DmSidebar.jsx');
const { default: Composer } = await import('./Composer.jsx');
const { default: ThreadPanel } = await import('./ThreadPanel.jsx');
const { default: MessageList } = await import('./MessageList.jsx');

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

const T = new Date('2026-10-16T14:00:00').getTime();
const chat = { space: 'S', channel: 'general', status: 'open', messages: [], currentUser: 'sandy', onSend: () => {}, onOpenThread: () => {}, onOpenMembers: () => {} };

test('phones get one More menu that holds Threads and Pinned messages', async () => {
  render(<ChatPanel {...chat} />);
  const more = screen.getByRole('button', { name: 'More' });
  expect(more.getAttribute('aria-haspopup')).toBe('menu');
  expect(more.getAttribute('aria-expanded')).toBe('false');
  // Only on phones: the separate buttons stay for md and up, the menu hides there.
  expect(more.className).toMatch(/\bmd:hidden\b/);
  expect(screen.getByRole('button', { name: 'Threads' }).className).toMatch(/\bhidden\b.*\bmd:inline-flex\b/);
  expect(screen.getByRole('button', { name: 'Pinned messages' }).className).toMatch(/\bhidden\b.*\bmd:inline-flex\b/);

  fireEvent.click(more);
  expect(more.getAttribute('aria-expanded')).toBe('true');
  const menu = screen.getByRole('menu', { name: 'More' });
  const items = screen.getAllByRole('menuitem');
  expect(items.map((i) => i.textContent.trim())).toEqual(['Threads', 'Pinned messages']);
  expect(document.activeElement).toBe(items[0]);

  // Esc closes it and puts focus back on the button.
  fireEvent.keyDown(menu, { key: 'Escape' });
  expect(screen.queryByRole('menu')).toBeNull();
  expect(document.activeElement).toBe(more);

  // Choosing Threads opens the same list the header button opens.
  fireEvent.click(more);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Threads' }));
  expect(screen.queryByRole('menu')).toBeNull();
  expect(await screen.findByText(/^Threads/)).toBeTruthy();
});

test('the More button carries the threads unread count', () => {
  render(<ChatPanel {...chat} threadsUnread={2} />);
  expect(screen.getByRole('button', { name: 'More (2 unread)' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'More (2 unread)' }));
  expect(screen.getByRole('menuitem', { name: 'Threads (2 unread)' })).toBeTruthy();
});

test('chat header buttons are tap-sized on coarse pointers', () => {
  render(<ChatPanel {...chat} />);
  for (const name of ['Channels', 'Members', 'More', 'Threads', 'Pinned messages', 'Search messages']) {
    expect(screen.getByRole('button', { name }).className, name).toMatch(/\btap\b/);
  }
});

test('channel, voice and DM rows are tap-sized rows', () => {
  render(
    <ChannelList
      space="S"
      channels={['general']}
      currentChannel="general"
      voiceChannels={['Lounge']}
      voiceParticipants={{}}
      activeVoiceParticipants={[]}
      user="sandy"
      status="open"
      selfId={1}
      canManage
      onSelect={() => {}}
      categories={[{ id: 1, name: 'Text channels', position: 0 }]}
      channelMeta={{ general: { type: 'text', category: 1, position: 0 }, Lounge: { type: 'voice', category: 1, position: 1 } }}
    />
  );
  expect(screen.getByRole('button', { name: 'general' }).className).toMatch(/\btap-row\b/);
  expect(screen.getByRole('button', { name: 'Lounge' }).className).toMatch(/\btap-row\b/);
  expect(screen.getByRole('button', { name: 'Create channel in Text channels' }).className).toMatch(/\btap\b/); // P3-25b: per category
  expect(screen.getByRole('button', { name: 'Text channels' }).className).toMatch(/\btap-row\b/); // the category heading
  expect(screen.getByRole('button', { name: 'Settings' }).className).toMatch(/\btap\b/);
  expect(screen.getByRole('button', { name: /Set status/ }).className).toMatch(/\btap\b/);
  cleanup();
  render(<DmSidebar conversations={[{ username: 'bob' }]} user="sandy" status="open" onSelect={() => {}} />);
  expect(screen.getByRole('button', { name: /bob/ }).className).toMatch(/\btap-row\b/);
});

test('composer controls are tap-sized and Send is an icon button on phones', () => {
  render(<Composer channel="general" onSend={() => {}} />);
  for (const name of ['Attach files', 'Emoji', 'Send']) {
    expect(screen.getByRole('button', { name }).className, name).toMatch(/\btap\b/);
  }
  const send = screen.getByRole('button', { name: 'Send' });
  // The word stays for md and up; phones get the icon alone.
  expect(send.querySelector('svg')).toBeTruthy();
  expect(send.querySelector('span').className).toMatch(/\bhidden\b.*\bmd:inline\b/);
});

test('thread header buttons are tap-sized', () => {
  const thread = { space: 'S', parentChannel: 'general', channel: '~t7', name: 'Weekend plans', rootMessageId: 7, root: { id: 7, author: 'bob', content: 'hi', timestamp: T } };
  render(
    <ThreadPanel space="S" thread={thread} status="open" messages={[]} currentUser="sandy" onSend={() => {}} onClose={() => {}} onSetArchived={() => {}} onToggleFollow={() => {}} />
  );
  for (const name of ['Archive thread', 'Follow thread', 'Close thread']) {
    expect(screen.getByRole('button', { name }).className, name).toMatch(/\btap(-chip)?\b/);
  }
});

test('reactions and thread chips get the smaller tap sizes', () => {
  const thread = { channel: '~t2', name: 'Weekend plans', messageCount: 1, lastActivityAt: T };
  render(
    <MessageList
      messages={[{ id: 2, author: 'bob', content: 'hi', timestamp: T, reactions: [{ emoji: '👍', count: 1, mine: false }], thread }]}
      channel="general"
      currentUser="sandy"
      onReact={() => {}}
      onOpenThread={() => {}}
    />
  );
  expect(screen.getByRole('button', { name: /👍 1/ }).className).toMatch(/\btap-reaction\b/);
  expect(screen.getByRole('button', { name: /Open thread Weekend plans/ }).className).toMatch(/\btap-chip\b/);
});
