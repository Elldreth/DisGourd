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
  getCategoryOverrides: vi.fn().mockResolvedValue({ overrides: [{ roleId: 1, view: 0, post: 0 }] }),
  setCategoryOverrides: vi.fn().mockResolvedValue({ overrides: [] }),
  applyCategoryOverrides: vi.fn().mockResolvedValue({ changed: 2 }),
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

// P3-25c: drag and drop. Each drop target gets a fake 20 px box, in page order.
function layOut() {
  const nav = screen.getByRole('navigation', { name: 'Channels' });
  const boxes = [...nav.querySelectorAll('[data-drop-row], [data-drop-heading], [data-drop-section]')];
  let y = 0;
  const rows = boxes.filter((el) => !el.hasAttribute('data-drop-section'));
  rows.forEach((el) => {
    const top = y;
    el.getBoundingClientRect = () => ({ top, bottom: top + 20, left: 0, right: 200, width: 200, height: 20 });
    y += 20;
  });
  // A section spans its heading to its last row.
  boxes.filter((el) => el.hasAttribute('data-drop-section')).forEach((el) => {
    const inside = rows.filter((r) => el.contains(r)).map((r) => r.getBoundingClientRect());
    el.getBoundingClientRect = () => ({ top: inside[0].top, bottom: inside.at(-1).bottom, left: 0, right: 200 });
  });
  return Object.fromEntries(rows.map((el) => [el.textContent.trim().split(/[\s,]/)[0] || el.dataset.group, el.getBoundingClientRect()]));
}
const pointer = (type, target, y) => fireEvent[type](target, { clientX: 10, clientY: y, button: 0, pointerType: 'mouse' });

test('dragging a channel onto another category sends the new layout; the click after the drag selects nothing', async () => {
  const onSelect = vi.fn();
  setup({ canManage: true, onSelect });
  const box = layOut(); // rules 0, Text 20, general 40, news 60, memes 80, Voice 100, lounge 120, Empty 140
  const general = screen.getByRole('button', { name: /^general/ });
  pointer('pointerDown', general, box.general.top + 5);
  pointer('pointerMove', window, box.general.top + 30); // past the 5 px threshold
  pointer('pointerMove', window, box.lounge.top + 15); // lower half of lounge
  expect(screen.getAllByTestId('drop-line')).toHaveLength(1);
  pointer('pointerUp', window, box.lounge.top + 15);
  fireEvent.click(general); // the click that ends the drag
  await waitFor(() => expect(api.setLayout).toHaveBeenCalledTimes(1));
  const sent = api.setLayout.mock.calls[0][1];
  expect(sent.channels.filter((c) => c.category === 2).map((c) => c.name)).toEqual(['lounge', 'general']);
  expect(sent.channels.filter((c) => c.category === 1).map((c) => c.name)).toEqual(['news', 'memes']);
  expect(onSelect).not.toHaveBeenCalled();
});

test('dragging a category heading reorders categories; Esc cancels; a small wobble is just a click', async () => {
  const onSelect = vi.fn();
  setup({ canManage: true, onSelect });
  const box = layOut();
  const voice = screen.getByRole('button', { name: 'Voice channels' });
  pointer('pointerDown', voice, box.Voice.top + 5);
  pointer('pointerMove', window, box.Voice.top - 30);
  pointer('pointerMove', window, box.Text.top + 2); // above the middle of the Text section → before it
  pointer('pointerUp', window, box.Text.top + 2);
  await waitFor(() => expect(api.setLayout).toHaveBeenCalledWith('S', expect.objectContaining({ categories: [2, 1, 3] })));
  // Esc during a drag: nothing sent.
  api.setLayout.mockClear();
  const news = screen.getByRole('button', { name: /^news/ });
  pointer('pointerDown', news, box.news.top + 5);
  pointer('pointerMove', window, box.lounge.top + 5);
  fireEvent.keyDown(window, { key: 'Escape' });
  pointer('pointerUp', window, box.lounge.top + 5);
  expect(screen.queryByTestId('drop-line')).toBeNull();
  // A 2 px wobble is a click, not a drag.
  pointer('pointerDown', news, box.news.top + 5);
  pointer('pointerMove', window, box.news.top + 7);
  pointer('pointerUp', window, box.news.top + 7);
  fireEvent.click(news);
  expect(onSelect).toHaveBeenCalledWith('news');
  expect(api.setLayout).not.toHaveBeenCalled();
});

test('members and touch screens can’t drag', () => {
  setup();
  const box = layOut();
  const general = screen.getByRole('button', { name: /^general/ });
  pointer('pointerDown', general, box.general.top + 5);
  pointer('pointerMove', window, box.lounge.top + 15);
  expect(screen.queryByTestId('drop-line')).toBeNull();
  cleanup();
  setup({ canManage: true });
  const box2 = layOut();
  fireEvent.pointerDown(screen.getByRole('button', { name: /^general/ }), { clientY: box2.general.top + 5, button: 0, pointerType: 'touch' });
  pointer('pointerMove', window, box2.lounge.top + 15);
  expect(screen.queryByTestId('drop-line')).toBeNull();
});

// P3-25d: category permissions.
const roles = [{ id: 1, name: '@everyone', isDefault: true, position: 0 }, { id: 2, name: 'Staff', position: 1, color: '#e66' }];

test('a category’s Permissions… edits its access, and Apply to all copies it onto its channels after asking', async () => {
  const onPermsChanged = vi.fn();
  setup({ canManage: true, isOwner: true, roles, onPermsChanged });
  fireEvent.click(screen.getByRole('button', { name: 'Options for Text channels' }));
  fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: /Permissions/ }));
  const dialog = await screen.findByRole('dialog', { name: 'Text channels permissions' });
  await waitFor(() => expect(api.getCategoryOverrides).toHaveBeenCalledWith('S', 1));
  expect(within(dialog).getByText(/start with this access/)).toBeTruthy();
  expect(within(dialog).queryByLabelText('Topic')).toBeNull(); // channel-only settings are hidden
  expect(within(dialog).queryByText(/Delete channel/)).toBeNull();
  await waitFor(() => expect(within(dialog).getByLabelText('@everyone: view').value).toBe('0')); // Deny
  fireEvent.change(within(dialog).getByLabelText('Staff: view'), { target: { value: '1' } }); // Allow
  fireEvent.click(within(dialog).getByRole('button', { name: /Apply to all channels in Text channels/ }));
  expect(within(dialog).getByText(/Their own settings are/)).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Apply to all' }));
  await waitFor(() => expect(api.applyCategoryOverrides).toHaveBeenCalledWith('S', 1));
  expect(api.setCategoryOverrides).toHaveBeenCalledWith('S', 1, expect.arrayContaining([{ roleId: 2, view: 1, post: null }, { roleId: 1, view: 0, post: 0 }]));
  expect(await within(dialog).findByText('Applied to 2 channels.')).toBeTruthy();
  expect(onPermsChanged).toHaveBeenCalled();
});

test('moving a channel into a category with its own access asks first; a plain category doesn’t', async () => {
  const gated = categories.map((c) => (c.id === 3 ? { ...c, hasOverrides: true } : c));
  setup({ canManage: true, roles: [], categories: gated });
  fireEvent.click(screen.getByRole('button', { name: 'Channel settings for news' }));
  const place = await screen.findByRole('group', { name: 'Place in the channel list' });
  // Into a plain category (Voice channels): straight away.
  fireEvent.change(within(place).getByLabelText('Category'), { target: { value: '2' } });
  await waitFor(() => expect(api.setLayout).toHaveBeenCalledTimes(1));
  // Into "Empty", which has its own access: a confirmation first.
  fireEvent.change(within(place).getByLabelText('Category'), { target: { value: '3' } });
  const confirm = await screen.findByRole('dialog', { name: 'Move into Empty?' });
  expect(confirm.textContent).toMatch(/#news will take Empty’s permissions, replacing its own/);
  expect(api.setLayout).toHaveBeenCalledTimes(1);
  fireEvent.click(within(confirm).getByRole('button', { name: 'Move' }));
  await waitFor(() => expect(api.setLayout).toHaveBeenCalledTimes(2));
  expect(api.setLayout.mock.calls[1][1].channels.find((c) => c.name === 'news')).toEqual({ name: 'news', category: 3 });
});

