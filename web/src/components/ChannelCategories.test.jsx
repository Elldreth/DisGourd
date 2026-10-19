// P3-25b: categories in the channel list — headings, collapsing, and what
// managers can do (create in a category, rename, move, delete).
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('../api.js', () => ({
  setLayout: vi.fn().mockResolvedValue({ ok: true }),
  createCategory: vi.fn().mockResolvedValue({ id: 9, name: 'New category', position: 3 }),
  renameCategory: vi.fn().mockResolvedValue({}),
  deleteCategory: vi.fn().mockResolvedValue({ ok: true }),
  getChannelOverrides: vi.fn().mockResolvedValue({ overrides: [] }),
}));
const api = await import('../api.js');
const { default: ChannelList } = await import('./ChannelList.jsx');

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});
afterEach(cleanup);

const categories = [{ id: 1, name: 'Text channels', position: 0 }, { id: 2, name: 'Voice channels', position: 1 }, { id: 3, name: 'Empty', position: 2 }];
const channelMeta = {
  rules: { type: 'text', category: null, position: 0 },
  general: { type: 'text', category: 1, position: 0 },
  news: { type: 'text', category: 1, position: 1 },
  memes: { type: 'text', category: 1, position: 2 },
  lounge: { type: 'voice', category: 2, position: 0 },
};
function setup(props = {}) {
  const onCreateChannel = vi.fn().mockResolvedValue();
  render(
    <ChannelList
      space="S"
      channels={['rules', 'general', 'news', 'memes']}
      voiceChannels={['lounge']}
      voiceParticipants={{}}
      activeVoiceParticipants={[]}
      currentChannel="news"
      mentions={{ memes: 1 }}
      user="sandy"
      status="open"
      selfId={1}
      onSelect={() => {}}
      onCreateChannel={onCreateChannel}
      categories={categories}
      channelMeta={channelMeta}
      {...props}
    />
  );
  return { onCreateChannel };
}
const inSection = (name) => within(screen.getByRole('region', { name })).queryAllByRole('button').map((b) => b.textContent.trim());

test('channels sit under their category headings, the uncategorized ones on top; members don’t see empty categories', () => {
  setup();
  const names = (region) => within(region).getAllByRole('button').map((b) => b.textContent.trim().split(/[\s,]/)[0]);
  const nav = screen.getByRole('navigation', { name: 'Channels' });
  const regions = within(nav).getAllByRole('region');
  expect(regions.map((r) => r.getAttribute('aria-label'))).toEqual(['Text channels', 'Voice channels']); // "Empty" hidden from members
  expect(names(regions[0])).toEqual(['Text', 'general', 'news', 'memes']);
  expect(names(regions[1])).toEqual(['Voice', 'lounge']);
  // "rules" (no category) comes before the first heading.
  const rules = screen.getByRole('button', { name: /^rules/ });
  expect(rules.compareDocumentPosition(regions[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Create channel in/ })).toBeNull(); // members have no manager controls
});

test('collapsing hides quiet channels but keeps the current one and mentioned ones, and is remembered', () => {
  setup();
  const heading = screen.getByRole('button', { name: 'Text channels' });
  expect(heading.getAttribute('aria-expanded')).toBe('true');
  fireEvent.click(heading);
  expect(heading.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByRole('button', { name: /^general/ })).toBeNull();
  expect(screen.getByRole('button', { name: /^news/ })).toBeTruthy(); // you're in it
  expect(screen.getByRole('button', { name: /^memes/ })).toBeTruthy(); // a mention
  expect(JSON.parse(localStorage.getItem('dg.collapsed'))).toEqual({ S: [1] });
  cleanup();
  setup();
  expect(screen.getByRole('button', { name: 'Text channels' }).getAttribute('aria-expanded')).toBe('false');
});

test('managers: + on a category creates the channel there (voice by default in an all-voice category)', async () => {
  const { onCreateChannel } = setup({ canManage: true });
  expect(screen.getByRole('region', { name: 'Empty' })).toBeTruthy(); // managers see empty categories
  fireEvent.click(screen.getByRole('button', { name: 'Create channel in Voice channels' }));
  expect(screen.getByLabelText('Channel type').value).toBe('voice');
  fireEvent.change(screen.getByLabelText('New channel name'), { target: { value: 'Game Night' } });
  fireEvent.submit(screen.getByLabelText('New channel name').closest('form'));
  await waitFor(() => expect(onCreateChannel).toHaveBeenCalledWith('game-night', 'voice', 2));
});

test('managers: a category’s menu renames, moves and deletes (with a confirmation that channels are kept)', async () => {
  setup({ canManage: true });
  fireEvent.click(screen.getByRole('button', { name: 'Options for Voice channels' }));
  const menu = screen.getByRole('menu', { name: 'Options for Voice channels' });
  fireEvent.click(within(menu).getByRole('menuitem', { name: /Move up/ }));
  await waitFor(() => expect(api.setLayout).toHaveBeenCalledWith('S', expect.objectContaining({ categories: [2, 1, 3] })));
  fireEvent.click(screen.getByRole('button', { name: 'Options for Empty' }));
  expect(within(screen.getByRole('menu')).queryByRole('menuitem', { name: /Move down/ })).toBeNull(); // already last
  fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: /Rename/ }));
  const input = screen.getByLabelText('Category name');
  fireEvent.change(input, { target: { value: 'Archive' } });
  fireEvent.submit(input.closest('form'));
  await waitFor(() => expect(api.renameCategory).toHaveBeenCalledWith('S', 3, 'Archive'));
  fireEvent.click(screen.getByRole('button', { name: 'Options for Text channels' }));
  fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: /Delete category/ }));
  const dialog = screen.getByRole('dialog', { name: /Delete the Text channels category/ });
  expect(dialog.textContent).toMatch(/Its channels are kept/);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete category' }));
  await waitFor(() => expect(api.deleteCategory).toHaveBeenCalledWith('S', 1));
});

test('managers: the server menu creates a category (then names it), and a channel’s settings move it', async () => {
  setup({ canManage: true, roles: [] });
  fireEvent.click(screen.getByRole('button', { name: 'S' }));
  fireEvent.click(screen.getByRole('button', { name: /Create category/ }));
  await waitFor(() => expect(api.createCategory).toHaveBeenCalledWith('S', 'New category'));
  // Channel settings: Move up / down and the category.
  fireEvent.click(screen.getByRole('button', { name: 'Channel settings for news' }));
  const place = await screen.findByRole('group', { name: 'Place in the channel list' });
  fireEvent.click(within(place).getByRole('button', { name: 'Move up' }));
  await waitFor(() => expect(api.setLayout).toHaveBeenLastCalledWith('S', expect.objectContaining({
    channels: expect.arrayContaining([{ name: 'news', category: 1 }]),
  })));
  const sent = api.setLayout.mock.calls.at(-1)[1].channels.filter((c) => c.category === 1).map((c) => c.name);
  expect(sent).toEqual(['news', 'general', 'memes']);
  fireEvent.change(within(place).getByLabelText('Category'), { target: { value: '' } });
  await waitFor(() => expect(api.setLayout.mock.calls.at(-1)[1].channels.filter((c) => c.category === null).map((c) => c.name)).toEqual(['rules', 'news']));
  expect(within(place).getByRole('button', { name: 'Move up' }).disabled).toBe(false);
});
