import { afterEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import MemberList from './MemberList.jsx';
import ChatPanel from './ChatPanel.jsx';

afterEach(cleanup);

const members = [
  { username: 'sandy', online: true, role: 'owner' },
  { username: 'bob', online: true, role: 'member' },
  { username: 'cara', online: false, role: 'member' },
];

function setup(props = {}) {
  const onClose = vi.fn();
  const onMessageUser = vi.fn();
  const utils = render(
    <MemberList members={members} currentUser="sandy" myRole="owner" canKickMembers myPosition={1e9} onMessageUser={onMessageUser} onToggleRole={() => {}} onKick={() => {}} onClose={onClose} {...props} />
  );
  return { onClose, onMessageUser, ...utils };
}

test('closed: the drawer is hidden from phones (and from Tab / screen readers)', () => {
  setup({ open: false });
  const panel = screen.getByRole('complementary', { name: 'Members', hidden: true });
  expect(panel.className).toMatch(/\binvisible\b/);
  expect(panel.className).toMatch(/lg:visible/); // always shown on desktop
  expect(screen.queryByTestId('members-backdrop')).toBeNull();
});

test('open: online and offline groups, a backdrop, focus inside', async () => {
  setup({ open: true });
  const panel = screen.getByRole('complementary', { name: 'Members' });
  expect(panel.className).not.toMatch(/(^| )invisible( |$)/);
  expect(screen.getByText(/Online — 2/i)).toBeTruthy();
  expect(screen.getByText(/Offline — 1/i)).toBeTruthy();
  expect(screen.getByTestId('members-backdrop')).toBeTruthy();
  await waitFor(() => expect(panel.contains(document.activeElement)).toBe(true));
});

test('the backdrop, the close button and Esc each close it', () => {
  const { onClose } = setup({ open: true });
  fireEvent.click(screen.getByTestId('members-backdrop'));
  fireEvent.click(screen.getByRole('button', { name: 'Close member list' }));
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(onClose).toHaveBeenCalledTimes(3);
});

test('Esc does nothing while the drawer is closed', () => {
  const { onClose } = setup({ open: false });
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(onClose).not.toHaveBeenCalled();
});

test('member actions work inside the drawer', () => {
  const { onMessageUser } = setup({ open: true });
  fireEvent.click(screen.getByText('bob'));
  fireEvent.click(screen.getByRole('button', { name: 'Message' }));
  expect(onMessageUser).toHaveBeenCalledWith('bob');
});

test('focus goes back where it was when the drawer closes', async () => {
  const opener = document.createElement('button');
  document.body.appendChild(opener);
  opener.focus();
  const { rerender } = setup({ open: true });
  await waitFor(() => expect(document.activeElement).not.toBe(opener));
  rerender(<MemberList members={members} currentUser="sandy" myRole="owner" canKickMembers myPosition={1e9} onMessageUser={() => {}} onToggleRole={() => {}} onKick={() => {}} onClose={() => {}} open={false} />);
  await waitFor(() => expect(document.activeElement).toBe(opener));
  opener.remove();
});

test('the chat header has a Members button (below desktop width) that reports its state', () => {
  const onOpenMembers = vi.fn();
  render(<ChatPanel space="S" channel="general" status="open" messages={[]} currentUser="sandy" onSend={() => {}} onOpenMembers={onOpenMembers} membersOpen={false} />);
  const btn = screen.getByRole('button', { name: 'Members' });
  expect(btn.className).toMatch(/lg:hidden/);
  expect(btn.getAttribute('aria-expanded')).toBe('false');
  act(() => btn.click());
  expect(onOpenMembers).toHaveBeenCalled();
});
