import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';

// P11-09: Settings › Site admin › People: find an account, suspend it (with a
// confirm and an optional reason) or lift the suspension.
const BOB = { username: 'bob', siteAdmin: false, suspended: false, suspendedAt: null, suspendedReason: null, lastSeenAt: Date.UTC(2026, 9, 20) };
vi.mock('../api.js', () => ({
  searchUsers: vi.fn(async () => ({ users: [] })),
  setSuspended: vi.fn(),
}));
const api = await import('../api.js');
const { default: PeopleAdmin } = await import('./PeopleAdmin.jsx');

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

async function search(q, me = 'sandy') {
  await act(async () => {
    render(<PeopleAdmin me={me} />);
  });
  await act(async () => {
    fireEvent.change(screen.getByLabelText('Find people'), { target: { value: q } });
    fireEvent.submit(screen.getByRole('search'));
  });
}

test('search lists matching accounts with their state', async () => {
  api.searchUsers.mockResolvedValue({ users: [BOB, { ...BOB, username: 'bobby', suspended: true, suspendedReason: 'spam', siteAdmin: true }] });
  await search('bob');
  expect(api.searchUsers).toHaveBeenCalledWith('bob');
  const rows = screen.getAllByRole('listitem');
  expect(rows).toHaveLength(2);
  expect(within(rows[0]).getByRole('button', { name: 'Suspend bob' })).toBeTruthy();
  expect(rows[1].textContent).toMatch(/Site admin/);
  expect(rows[1].textContent).toMatch(/Suspended · spam/);
  expect(within(rows[1]).getByRole('button', { name: 'Lift suspension for bobby' })).toBeTruthy();
});

test('your own row has no button', async () => {
  api.searchUsers.mockResolvedValue({ users: [{ ...BOB, username: 'sandy', siteAdmin: true }] });
  await search('sandy');
  expect(screen.getByRole('listitem').textContent).toMatch(/You$/);
  expect(screen.queryByRole('button', { name: /Suspend sandy/ })).toBeNull();
});

test('nobody matches: says so', async () => {
  api.searchUsers.mockResolvedValue({ users: [] });
  await search('zz');
  expect(screen.getByText('Nobody matches “zz”.')).toBeTruthy();
});

test('suspend asks first, takes an optional reason, and shows the new state', async () => {
  api.searchUsers.mockResolvedValue({ users: [BOB] });
  api.setSuspended.mockResolvedValue({ ...BOB, suspended: true, suspendedReason: 'spam links' });
  await search('bob');
  fireEvent.click(screen.getByRole('button', { name: 'Suspend bob' }));
  const dialog = screen.getByRole('dialog');
  expect(dialog.textContent).toMatch(/signed out everywhere/);
  fireEvent.change(within(dialog).getByLabelText('Reason (optional, only site admins see it)'), { target: { value: 'spam links' } });
  await act(async () => {
    fireEvent.click(within(dialog).getByRole('button', { name: 'Suspend' }));
  });
  expect(api.setSuspended).toHaveBeenCalledWith('bob', true, 'spam links');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('listitem').textContent).toMatch(/Suspended · spam links/);
});

test('lifting a suspension, and an error from the server', async () => {
  api.searchUsers.mockResolvedValue({ users: [{ ...BOB, suspended: true }] });
  api.setSuspended.mockResolvedValueOnce({ ...BOB, suspended: false });
  await search('bob');
  fireEvent.click(screen.getByRole('button', { name: 'Lift suspension for bob' }));
  await act(async () => {
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Lift suspension' }));
  });
  expect(api.setSuspended).toHaveBeenCalledWith('bob', false, undefined);
  expect(screen.getByRole('button', { name: 'Suspend bob' })).toBeTruthy();

  api.setSuspended.mockRejectedValueOnce(new Error("You can't suspend yourself"));
  fireEvent.click(screen.getByRole('button', { name: 'Suspend bob' }));
  await act(async () => {
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Suspend' }));
  });
  expect(screen.getByRole('alert').textContent).toBe("You can't suspend yourself");
});
