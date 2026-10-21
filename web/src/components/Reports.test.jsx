// P9-01: Report… in the message menu, the report dialog, the moderators'
// Reports section and its actions, the rail badge, and the menu item.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('../api.js', () => ({
  getReports: vi.fn(),
  resolveReport: vi.fn(async () => ({ closed: 1 })),
  timeoutMember: vi.fn(async () => ({})),
  banMember: vi.fn(async () => ({})),
  previewInvite: vi.fn(),
  getModLog: vi.fn(async () => ({ entries: [], more: false })),
  getBans: vi.fn(async () => ({ bans: [] })),
}));
const api = await import('../api.js');
const { default: MessageList } = await import('./MessageList.jsx');
const { default: ReportDialog } = await import('./ReportDialog.jsx');
const { default: ReportsSection } = await import('./server-settings/ReportsSection.jsx');
const { default: ServerRail } = await import('./ServerRail.jsx');
const { default: ChannelList } = await import('./ChannelList.jsx');

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

const T = new Date('2026-10-20T15:00:00').getTime();

test('Report… is offered on other people’s messages only, not your own or the bot’s', () => {
  const onReport = vi.fn();
  const msgs = [
    { id: 1, author: 'cara', content: 'spammy', timestamp: T },
    { id: 2, author: 'sandy', content: 'mine', timestamp: T + 1 },
    { id: 3, author: 'Imagine', bot: true, content: 'a picture', timestamp: T + 2 },
  ];
  const { container } = render(<MessageList messages={msgs} channel="general" currentUser="sandy" onReport={onReport} />);
  const row = (id) => container.querySelector(`[data-msg-id="${id}"]`);
  fireEvent.contextMenu(row(2));
  expect(screen.queryByRole('menuitem', { name: 'Report…' })).toBeNull();
  fireEvent.keyDown(document, { key: 'Escape' });
  fireEvent.contextMenu(row(3));
  expect(screen.queryByRole('menuitem', { name: 'Report…' })).toBeNull();
  fireEvent.keyDown(document, { key: 'Escape' });
  fireEvent.contextMenu(row(1));
  // P10-01: Report and Block sit together between dividers, Delete after.
  const menu = screen.getByRole('menuitem', { name: 'Report…' }).closest('[role="menu"]');
  const order = [...menu.children].map((el) => (el.getAttribute('role') === 'separator' ? '—' : el.textContent));
  expect(order.slice(order.indexOf('—'))).toEqual(['—', 'Report…']); // no Block here (no blocking provider), no Delete (not mine)
  fireEvent.click(screen.getByRole('menuitem', { name: 'Report…' }));
  expect(onReport).toHaveBeenCalledWith(msgs[0]);
});

test('the report dialog needs a reason, sends it with the note, then thanks you', async () => {
  const onReport = vi.fn(async () => ({}));
  render(<ReportDialog author="cara" excerpt="buy cheap gourds" onReport={onReport} onClose={() => {}} />);
  expect(screen.getByRole('dialog', { name: 'Report @cara’s message?' })).toBeTruthy();
  expect(screen.getByTestId('report-excerpt').textContent).toBe('buy cheap gourds'); // P10-01: which message
  expect(screen.getByRole('button', { name: 'Report' }).disabled).toBe(true);
  fireEvent.click(screen.getByRole('radio', { name: 'Harassment' }));
  fireEvent.change(screen.getByLabelText('Anything to add? (optional)'), { target: { value: '  third time  ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Report' }));
  await waitFor(() => expect(onReport).toHaveBeenCalledWith({ reason: 'harassment', note: 'third time' }));
  expect((await screen.findByRole('status')).textContent).toBe('Thanks — the moderators will take a look.');
});

test("the report dialog shows the server's refusal", async () => {
  render(<ReportDialog author="cara" onReport={vi.fn(async () => { throw new Error("You can't report your own message"); })} onClose={() => {}} />);
  fireEvent.click(screen.getByRole('radio', { name: 'Spam' }));
  fireEvent.click(screen.getByRole('button', { name: 'Report' }));
  expect((await screen.findByRole('alert')).textContent).toBe("You can't report your own message");
});

const open = (over = {}) => ({ id: 5, messageId: 41, channel: 'general', author: 'cara', reporter: 'bob', reason: 'spam', note: 'third time', excerpt: 'buy gourds', status: 'open', messageExists: true, createdAt: T, ...over });
const members = [
  { username: 'sandy', position: 1e9 },
  { username: 'ada', position: 2 },
  { username: 'cara', position: 0 },
];
function section(props = {}) {
  return render(<ReportsSection space="Tx" members={members} myPosition={2} abilities={['delete_others_messages', 'timeout_members']} openCount={1} {...props} />);
}

// The "Act on" menu's items, opened from a card.
function actOn(item, name) {
  fireEvent.click(within(item).getByRole('button', { name: `Act on ${name}` }));
  return screen.getByRole('menu', { name: `Act on ${name}` });
}

test('an open report shows the message, reason, note and reporter; Mark handled leads, the rest is in Act on', async () => {
  const onJump = vi.fn();
  api.getReports.mockResolvedValue({ reports: [open()], more: false });
  section({ onJump });
  const item = await screen.findByRole('listitem');
  expect(api.getReports).toHaveBeenCalledWith('Tx', { status: 'open' });
  expect(item.textContent).toContain('cara in #general');
  expect(item.textContent).toContain('Spam');
  expect(item.textContent).toContain('reported by bob (“third time”)');
  const buttons = within(item).getAllByRole('button').map((b) => b.textContent);
  expect(buttons).toEqual(['buy gourds', 'Mark handled', 'Dismiss', 'Act on cara']);
  fireEvent.click(within(item).getByRole('button', { name: 'Open the message: buy gourds' }));
  expect(onJump).toHaveBeenCalledWith(open());
  const menu = actOn(item, 'cara');
  expect(within(menu).getAllByRole('menuitem').map((b) => b.textContent)).toEqual(['Delete message', 'Time out…']); // no Ban: no permission
  fireEvent.click(within(menu).getByRole('menuitem', { name: 'Delete message' }));
  await waitFor(() => expect(api.resolveReport).toHaveBeenCalledWith('Tx', 5, { action: 'delete', resolution: undefined }));
});

test('reports on the same message are one card, with every reason and reporter (P10-01)', async () => {
  api.getReports.mockResolvedValue({
    reports: [open({ id: 9, reporter: 'dee', note: '' }), open({ id: 8, reporter: 'ada', reason: 'harassment', note: 'rude' }), open()],
    more: false,
  });
  section();
  const [item] = await screen.findAllByRole('listitem');
  expect(screen.getAllByRole('listitem')).toHaveLength(1);
  expect(item.textContent).toContain('Spam ×2Harassment');
  expect(item.textContent).toContain('reported by dee, ada (“rude”) and bob (“third time”)');
  fireEvent.click(within(item).getByRole('button', { name: 'Mark handled' }));
  // One call closes them all on the server.
  await waitFor(() => expect(api.resolveReport).toHaveBeenCalledTimes(1));
  expect(api.resolveReport).toHaveBeenCalledWith('Tx', 9, { action: 'resolved', resolution: undefined });
});

test('a higher-ranked author or a deleted message limits the actions; Dismiss closes each report on a deleted message', async () => {
  api.getReports.mockResolvedValue({
    reports: [open({ author: 'sandy' }), open({ id: 6, messageExists: false, messageId: null, excerpt: 'gone' }), open({ id: 7, messageExists: false, messageId: null, excerpt: 'gone', reporter: 'dee' })],
    more: false,
  });
  section();
  const [higher, gone] = await screen.findAllByRole('listitem');
  expect(within(higher).getAllByRole('button').map((b) => b.textContent)).toEqual(['Mark handled', 'Dismiss']);
  expect(gone.textContent).toContain('This message was deleted');
  expect(gone.textContent).toContain('reported by bob (“third time”) and dee');
  // Nothing to delete any more, but cara can still be timed out.
  expect(within(actOn(gone, 'cara')).getAllByRole('menuitem').map((b) => b.textContent)).toEqual(['Time out…']);
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
  fireEvent.click(within(gone).getByRole('button', { name: 'Dismiss' }));
  await waitFor(() => expect(api.resolveReport).toHaveBeenCalledTimes(2));
  expect(api.resolveReport).toHaveBeenCalledWith('Tx', 6, { action: 'dismiss', resolution: undefined });
  expect(api.resolveReport).toHaveBeenCalledWith('Tx', 7, { action: 'dismiss', resolution: undefined });
});

test('Time out… from a report times them out, then marks it handled', async () => {
  api.getReports.mockResolvedValue({ reports: [open()], more: false });
  section();
  fireEvent.click(within(actOn(await screen.findByRole('listitem'), 'cara')).getByRole('menuitem', { name: 'Time out…' }));
  fireEvent.click(screen.getByRole('radio', { name: '1 day' }));
  fireEvent.click(screen.getByRole('button', { name: 'Time out' }));
  await waitFor(() => expect(api.timeoutMember).toHaveBeenCalledWith('Tx', 'cara', { minutes: 1440, reason: '' }));
  await waitFor(() => expect(api.resolveReport).toHaveBeenCalledWith('Tx', 5, { action: 'resolved', resolution: 'timeout' }));
});

test('Closed shows how each report ended; an empty queue says so', async () => {
  api.getReports.mockImplementation(async (space, { status }) =>
    status === 'open'
      ? { reports: [], more: false }
      : { reports: [open({ status: 'resolved', resolution: 'deleted', resolvedBy: 'ada', messageExists: false }), open({ id: 7, messageId: 42, status: 'dismissed', resolvedBy: 'sandy' })], more: false }
  );
  section({ openCount: 0 });
  expect(await screen.findByText('No open reports. All quiet.')).toBeTruthy();
  expect(document.querySelector('svg[data-art="clear"]')).toBeTruthy(); // P10-01: the "all clear" mascot
  fireEvent.click(screen.getByRole('button', { name: 'Closed' }));
  const items = await screen.findAllByRole('listitem');
  expect(items[0].textContent).toContain('Handled (message deleted) by ada');
  expect(items[1].textContent).toContain('Dismissed by sandy');
  expect(within(items[1]).queryByRole('button', { name: 'Dismiss' })).toBeNull();
});

test('the rail shows open reports on a server, for moderators', () => {
  render(<ServerRail spaces={[{ name: 'Tx', openReports: 3 }, { name: 'Calm' }]} currentSpace="" onSelect={() => {}} onCreate={() => {}} onJoin={() => {}} onSelectDms={() => {}} />);
  const icon = screen.getByRole('button', { name: 'Tx, 3 open reports' });
  expect(screen.getByRole('button', { name: 'Calm' })).toBeTruthy();
  // The badge sits on top of the icon, outside the button (whose rounded mask
  // clips anything inside it), selected or not.
  const badge = screen.getByTestId('reports-badge-Tx');
  expect(badge.textContent).toBe('3');
  expect(icon.contains(badge)).toBe(false);
  expect(badge.parentElement).toBe(icon.parentElement);
  expect(screen.queryByTestId('reports-badge-Calm')).toBeNull();
});

test('the server menu shows Reports only while some are open; it opens Server settings › Reports', async () => {
  api.getReports.mockResolvedValue({ reports: [], more: false });
  const props = (openReports) => ({
    space: 'Tx', channels: ['general'], currentChannel: 'general', voiceChannels: [], voiceParticipants: {}, activeVoiceParticipants: [],
    user: 'ada', status: 'open', selfId: 1, onSelect: () => {}, onInvite: () => {}, channelMeta: { general: { type: 'text' } },
    abilities: ['delete_others_messages'], role: 'admin', members, openReports,
  });
  render(<ChannelList {...props(0)} />);
  fireEvent.click(screen.getByRole('button', { name: 'Tx' }));
  expect(screen.queryByRole('button', { name: /^Reports/ })).toBeNull();
  cleanup();
  render(<ChannelList {...props(2)} />);
  fireEvent.click(screen.getByRole('button', { name: 'Tx' }));
  fireEvent.click(screen.getByRole('button', { name: /^Reports/ }));
  const dialog = await screen.findByRole('dialog', { name: 'Server settings' });
  // P10-01: the list shows the open count beside Reports.
  expect(within(dialog).getByRole('tab', { name: /^Reports\s*2 open$/ }).getAttribute('aria-selected')).toBe('true');
  await waitFor(() => expect(api.getReports).toHaveBeenCalledWith('Tx', { status: 'open' }));
});

test('handled and dismissed reports read as sentences in the moderation log', async () => {
  const { describeEntry } = await import('./server-settings/ModLogSection.jsx');
  const text = (e) => render(<div>{describeEntry(e)}</div>).container.textContent;
  expect(text({ action: 'report_resolve', actor: 'sandy', target: 'cara', details: { channel: 'general', reason: 'spam', resolution: 'deleted', reports: 1 } }))
    .toBe('sandy handled a report (spam) on cara’s message in #general — message deleted');
  expect(text({ action: 'report_dismiss', actor: 'ada', target: 'cara', details: { channel: 'general', reason: 'other', resolution: null, reports: 2 } }))
    .toBe('ada dismissed 2 reports (other) on cara’s message in #general');
});
