import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const previews = {
  abc123: { space: 'Tx Check', members: 2, alreadyMember: false },
  mine99: { space: 'Smoke Test', members: 5, alreadyMember: true },
};
vi.mock('../api.js', () => ({
  previewInvite: vi.fn(async (code) => {
    if (previews[code]) return previews[code];
    throw new Error('This invite is invalid or has expired');
  }),
}));
const api = await import('../api.js');
const { default: CreateServerDialog, extractInviteCode } = await import('./CreateServerDialog.jsx');

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

function setup(props = {}) {
  const onCreate = vi.fn(async () => {});
  const onJoin = vi.fn(async () => {});
  const onClose = vi.fn();
  render(<CreateServerDialog initialTab="create" onCreate={onCreate} onJoin={onJoin} onClose={onClose} {...props} />);
  return { onCreate, onJoin, onClose };
}

test('extractInviteCode takes a bare code or pulls it out of a link', () => {
  expect(extractInviteCode('  abc123 ')).toBe('abc123');
  expect(extractInviteCode('https://chat.example.com/invite/abc123')).toBe('abc123');
  expect(extractInviteCode('https://chat.example.com/invites/abc123/')).toBe('abc123');
  expect(extractInviteCode('https://chat.example.com/?invite=abc123')).toBe('abc123');
  expect(extractInviteCode('')).toBe('');
});

test('a modal dialog with Create / Join tabs; arrow keys switch tabs', async () => {
  setup();
  expect(screen.getByRole('dialog', { name: 'Add a server' })).toBeTruthy();
  const create = screen.getByRole('tab', { name: 'Create' });
  const join = screen.getByRole('tab', { name: 'Join' });
  expect(create.getAttribute('aria-selected')).toBe('true');
  expect(screen.getByRole('tabpanel', { name: 'Create' })).toBeTruthy();
  create.focus();
  fireEvent.keyDown(create, { key: 'ArrowRight' });
  expect(join.getAttribute('aria-selected')).toBe('true');
  expect(document.activeElement).toBe(join);
  expect(screen.getByRole('tabpanel', { name: 'Join' })).toBeTruthy();
  fireEvent.keyDown(join, { key: 'ArrowLeft' });
  expect(create.getAttribute('aria-selected')).toBe('true');
});

test('opens on the Join tab when asked', () => {
  setup({ initialTab: 'join' });
  expect(screen.getByRole('tab', { name: 'Join' }).getAttribute('aria-selected')).toBe('true');
});

test('Create: Enter submits the name, the counter shows the limit, success closes', async () => {
  const { onCreate, onClose } = setup();
  const box = screen.getByRole('textbox', { name: 'Server name' });
  expect(box.getAttribute('maxlength')).toBe('60');
  fireEvent.change(box, { target: { value: 'Book Club' } });
  expect(screen.getByText('9/60')).toBeTruthy();
  await act(async () => {
    fireEvent.submit(box.closest('form'));
  });
  expect(onCreate).toHaveBeenCalledWith('Book Club');
  expect(onClose).toHaveBeenCalled();
});

test('Create: a server error shows in the dialog, which stays open', async () => {
  const onCreate = vi.fn(async () => {
    throw new Error('A server with that name already exists');
  });
  const { onClose } = setup({ onCreate });
  const box = screen.getByRole('textbox', { name: 'Server name' });
  fireEvent.change(box, { target: { value: 'Tx Check' } });
  await act(async () => {
    fireEvent.submit(box.closest('form'));
  });
  expect(screen.getByRole('alert').textContent).toBe('A server with that name already exists');
  expect(onClose).not.toHaveBeenCalled();
});

test('Join: a pasted link is previewed (server, members) before joining', async () => {
  const { onJoin, onClose } = setup({ initialTab: 'join' });
  const box = screen.getByRole('textbox', { name: 'Invite code or link' });
  fireEvent.change(box, { target: { value: 'https://chat.example.com/invite/abc123' } });
  await waitFor(() => expect(screen.getByText(/Tx Check/)).toBeTruthy());
  expect(api.previewInvite).toHaveBeenLastCalledWith('abc123');
  expect(screen.getByText(/2 members/)).toBeTruthy();
  await act(async () => {
    fireEvent.submit(box.closest('form'));
  });
  expect(onJoin).toHaveBeenCalledWith('abc123');
  expect(onClose).toHaveBeenCalled();
});

test('Join: says when you are already a member', async () => {
  setup({ initialTab: 'join' });
  fireEvent.change(screen.getByRole('textbox', { name: 'Invite code or link' }), { target: { value: 'mine99' } });
  await waitFor(() => expect(screen.getByText(/already a member/i)).toBeTruthy());
});

test('Join: an invalid code shows the server error inline', async () => {
  const onJoin = vi.fn(async () => {
    throw new Error('This invite is invalid or has expired');
  });
  const { onClose } = setup({ initialTab: 'join', onJoin });
  const box = screen.getByRole('textbox', { name: 'Invite code or link' });
  fireEvent.change(box, { target: { value: 'nope' } });
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('This invite is invalid or has expired'));
  await act(async () => {
    fireEvent.submit(box.closest('form'));
  });
  expect(screen.getByRole('alert').textContent).toBe('This invite is invalid or has expired');
  expect(onClose).not.toHaveBeenCalled();
});

test('Join: opened with a code from an invite link, it is filled in and previewed at once; Enter joins', async () => {
  const { onJoin, onClose } = setup({ initialTab: 'join', initialCode: 'abc123' });
  const box = screen.getByRole('textbox', { name: 'Invite code or link' });
  expect(box.value).toBe('abc123');
  await waitFor(() => expect(document.activeElement).toBe(box));
  await waitFor(() => expect(screen.getByText(/Tx Check/)).toBeTruthy());
  expect(api.previewInvite).toHaveBeenCalledWith('abc123');
  await act(async () => {
    fireEvent.submit(box.closest('form'));
  });
  expect(onJoin).toHaveBeenCalledWith('abc123');
  expect(onClose).toHaveBeenCalled();
});
