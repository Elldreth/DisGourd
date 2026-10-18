import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ConfirmDialog from './ConfirmDialog.jsx';
import MemberList from './MemberList.jsx';
import ChannelList from './ChannelList.jsx';

let confirmSpy;
beforeEach(() => {
  // The browser's confirm() must never be used for these.
  confirmSpy = vi.spyOn(window, 'confirm').mockImplementation(() => {
    throw new Error('window.confirm was called');
  });
});
afterEach(() => {
  cleanup();
  confirmSpy.mockRestore();
});

function setup(props = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(<ConfirmDialog title="Remove @bob from Tx Check?" body="They can rejoin with an invite." confirmLabel="Remove" onConfirm={onConfirm} onCancel={onCancel} {...props} />);
  return { onConfirm, onCancel };
}

test('a dialog named by its question, with the body text', () => {
  setup();
  expect(screen.getByRole('dialog', { name: 'Remove @bob from Tx Check?' })).toBeTruthy();
  expect(screen.getByText('They can rejoin with an invite.')).toBeTruthy();
});

test('for a dangerous action, focus starts on Cancel', async () => {
  setup({ danger: true });
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' })));
});

test('confirm, cancel and Esc', () => {
  const { onConfirm, onCancel } = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
  expect(onConfirm).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  fireEvent.keyDown(screen.getByRole('button', { name: 'Cancel' }), { key: 'Escape' });
  expect(onCancel).toHaveBeenCalledTimes(2);
});

test('requireText: the button stays disabled until the exact text is typed; Enter then confirms', async () => {
  const { onConfirm } = setup({ title: 'Delete Tx Check?', confirmLabel: 'Delete server', danger: true, requireText: 'Tx Check' });
  const box = screen.getByRole('textbox', { name: /type tx check to confirm/i });
  const btn = screen.getByRole('button', { name: 'Delete server' });
  await waitFor(() => expect(document.activeElement).toBe(box));
  expect(btn.disabled).toBe(true);
  fireEvent.change(box, { target: { value: 'tx check' } }); // case matters
  expect(btn.disabled).toBe(true);
  fireEvent.keyDown(box, { key: 'Enter' });
  expect(onConfirm).not.toHaveBeenCalled();
  fireEvent.change(box, { target: { value: 'Tx Check' } });
  expect(btn.disabled).toBe(false);
  fireEvent.keyDown(box, { key: 'Enter' });
  expect(onConfirm).toHaveBeenCalledTimes(1);
});

// ---- where it's used ----

const members = [
  { username: 'sandy', online: true, role: 'owner' },
  { username: 'bob', online: true, role: 'member' },
];

test('kicking a member asks in-app, then removes them only if you confirm', async () => {
  const onKick = vi.fn();
  render(<MemberList space="Tx Check" members={members} currentUser="sandy" myRole="owner" canKickMembers myPosition={1e9} onMessageUser={() => {}} onToggleRole={() => {}} onKick={onKick} />);
  fireEvent.click(screen.getByText('bob'));
  fireEvent.click(screen.getByRole('button', { name: 'Remove from server' }));
  const dialog = screen.getByRole('dialog', { name: 'Remove @bob from Tx Check?' });
  expect(dialog.textContent).toMatch(/rejoin with an invite/i);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(onKick).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).toBeNull();

  fireEvent.click(screen.getByText('bob'));
  fireEvent.click(screen.getByRole('button', { name: 'Remove from server' }));
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
  expect(onKick).toHaveBeenCalledWith('bob');
});

test('deleting a server needs its name typed first', async () => {
  const onDeleteServer = vi.fn();
  render(<ChannelList space="Tx Check" channels={[]} isOwner canManage onDeleteServer={onDeleteServer} onSelect={() => {}} />);
  fireEvent.click(screen.getByRole('heading', { name: 'Tx Check' }));
  fireEvent.click(screen.getByRole('button', { name: /delete server/i }));
  const dialog = screen.getByRole('dialog', { name: 'Delete Tx Check?' });
  const confirm = screen.getAllByRole('button', { name: 'Delete server' }).find((b) => dialog.contains(b));
  expect(confirm.disabled).toBe(true);
  fireEvent.change(screen.getByRole('textbox', { name: /type tx check to confirm/i }), { target: { value: 'Tx Check' } });
  fireEvent.click(confirm);
  expect(onDeleteServer).toHaveBeenCalledTimes(1);
});

test('cancelling the delete keeps the server', () => {
  const onDeleteServer = vi.fn();
  render(<ChannelList space="Tx Check" channels={[]} isOwner canManage onDeleteServer={onDeleteServer} onSelect={() => {}} />);
  fireEvent.click(screen.getByRole('heading', { name: 'Tx Check' }));
  fireEvent.click(screen.getByRole('button', { name: /delete server/i }));
  fireEvent.keyDown(screen.getByRole('button', { name: 'Cancel' }), { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(onDeleteServer).not.toHaveBeenCalled();
});
