// P3-26b: Ban… in the member menu, the Ban dialog, the Bans list, and ban
// entries in the moderation log.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../api.js', () => ({
  getBans: vi.fn(),
  unbanMember: vi.fn(async () => ({ ok: true })),
}));
const api = await import('../api.js');
const { default: MemberList } = await import('./MemberList.jsx');
const { default: BansDialog } = await import('./BansDialog.jsx');
const { describeEntry } = await import('./ModLogDialog.jsx');

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const members = [
  { username: 'sandy', online: true, role: 'owner', position: 1e9 },
  { username: 'ada', online: true, role: 'admin', position: 2 },
  { username: 'bob', online: true, role: 'member', position: 0 },
];

function list(props) {
  return render(
    <MemberList space="Tx" members={members} currentUser="ada" myRole="admin" myPosition={2} onMessageUser={() => {}} onToggleRole={() => {}} onKick={() => {}} open {...props} />
  );
}
const openMenu = (name) => fireEvent.click(screen.getByTitle(name));

test('Ban… is offered for people below me, only with "Ban members"', () => {
  list({ canBanMembers: false });
  openMenu('bob');
  expect(screen.queryByText('Ban…')).toBeNull();
  cleanup();
  list({ canBanMembers: true });
  openMenu('sandy');
  expect(screen.queryByText('Ban…')).toBeNull(); // the owner sits above me
  openMenu('bob');
  expect(screen.getByText('Ban…')).toBeTruthy();
});

test('the Ban dialog sends the reason and the delete window, and closes', async () => {
  const onBan = vi.fn(async () => {});
  list({ canBanMembers: true, onBan });
  openMenu('bob');
  fireEvent.click(screen.getByText('Ban…'));
  expect(screen.getByRole('dialog', { name: 'Ban @bob from Tx?' })).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Reason (optional)'), { target: { value: '  spam links ' } });
  fireEvent.change(screen.getByLabelText('Delete their messages from'), { target: { value: 'day' } });
  fireEvent.click(screen.getByRole('button', { name: 'Ban' }));
  await waitFor(() => expect(onBan).toHaveBeenCalledWith('bob', { reason: 'spam links', deleteMessages: 'day' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: /Ban @bob/ })).toBeNull());
});

test("the Ban dialog shows the server's refusal and stays open", async () => {
  const onBan = vi.fn(async () => {
    throw new Error('You cannot ban this member');
  });
  list({ canBanMembers: true, onBan });
  openMenu('bob');
  fireEvent.click(screen.getByText('Ban…'));
  fireEvent.click(screen.getByRole('button', { name: 'Ban' }));
  expect((await screen.findByRole('alert')).textContent).toBe('You cannot ban this member');
  expect(onBan).toHaveBeenCalledWith('bob', { reason: '', deleteMessages: 'none' });
  expect(screen.getByRole('dialog', { name: /Ban @bob/ })).toBeTruthy();
});

test('the Bans list shows who, by whom and why; Unban removes the row', async () => {
  api.getBans.mockResolvedValue({ bans: [
    { username: 'bob', by: 'ada', reason: 'spam links', createdAt: Date.now() },
    { username: 'eve', by: null, reason: null, createdAt: Date.now() },
  ] });
  render(<BansDialog space="Tx" onClose={() => {}} />);
  expect(screen.getByRole('dialog', { name: 'Bans — Tx' })).toBeTruthy();
  await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2));
  expect(screen.getAllByRole('listitem')[0].textContent).toContain('by ada');
  expect(screen.getAllByRole('listitem')[0].textContent).toContain('spam links');
  fireEvent.click(screen.getByRole('button', { name: 'Unban bob' }));
  await waitFor(() => expect(api.unbanMember).toHaveBeenCalledWith('Tx', 'bob'));
  await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
});

test('an empty Bans list says so', async () => {
  api.getBans.mockResolvedValue({ bans: [] });
  render(<BansDialog space="Tx" onClose={() => {}} />);
  expect(await screen.findByText('Nobody is banned.')).toBeTruthy();
});

test('ban and unban entries read as sentences in the moderation log', () => {
  const text = (e) => render(<div>{describeEntry(e)}</div>).container.textContent;
  expect(text({ action: 'ban', actor: 'ada', target: 'bob', details: { deleteMessages: 'day', deleted: 3 } })).toBe('ada banned bob and deleted 3 messages from the last day');
  expect(text({ action: 'ban', actor: 'ada', target: 'bob', details: { deleteMessages: 'none', deleted: 0 } })).toBe('ada banned bob');
  expect(text({ action: 'unban', actor: 'ada', target: 'bob', details: null })).toBe('ada unbanned bob');
});
