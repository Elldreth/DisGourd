import { afterEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

// The real picker needs the emoji data; this one offers a single emoji.
vi.mock('./EmojiPicker.jsx', () => ({
  default: ({ onPick, onClose }) => (
    <div role="dialog" aria-label="Emoji picker">
      <button type="button" onClick={() => onPick('🌴')}>palm tree</button>
      <button type="button" onClick={onClose}>close picker</button>
    </div>
  ),
}));
const { default: StatusDialog } = await import('./StatusDialog.jsx');
const { default: UserFooter } = await import('./UserFooter.jsx');
const { default: MemberList } = await import('./MemberList.jsx');

afterEach(cleanup);

test('set text, an emoji and when to clear it', async () => {
  const onSave = vi.fn(async () => {});
  const onClose = vi.fn();
  render(<StatusDialog current={{}} onSave={onSave} onClose={onClose} />);
  expect(screen.getByRole('dialog', { name: 'Set a custom status' })).toBeTruthy();
  const box = screen.getByRole('textbox', { name: "What's happening?" });
  await waitFor(() => expect(document.activeElement).toBe(box));
  expect(box.getAttribute('maxlength')).toBe('80');
  fireEvent.change(box, { target: { value: 'On holiday' } });
  expect(screen.getByText('10/80')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Choose an emoji' }));
  fireEvent.click(screen.getByRole('button', { name: 'palm tree' }));
  expect(screen.getByRole('button', { name: 'Change emoji (🌴)' })).toBeTruthy();
  fireEvent.change(screen.getByRole('combobox', { name: 'Clear after' }), { target: { value: '4h' } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  });
  expect(onSave).toHaveBeenCalledWith({ statusText: 'On holiday', statusEmoji: '🌴', statusExpiresIn: '4h' });
  expect(onClose).toHaveBeenCalled();
});

test('starts from your current status; Clear status removes it', async () => {
  const onSave = vi.fn(async () => {});
  render(<StatusDialog current={{ statusText: 'Lunch', statusEmoji: '🍜' }} onSave={onSave} onClose={() => {}} />);
  expect(screen.getByRole('textbox', { name: "What's happening?" }).value).toBe('Lunch');
  expect(screen.getByRole('combobox', { name: 'Clear after' }).value).toBe(''); // "Don't clear" by default
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Clear status' }));
  });
  expect(onSave).toHaveBeenCalledWith({ statusText: '', statusEmoji: null, statusExpiresIn: null });
});

test('a server error stays in the dialog', async () => {
  const onSave = vi.fn(async () => {
    throw new Error('Status emoji must be a single emoji');
  });
  const onClose = vi.fn();
  render(<StatusDialog current={{}} onSave={onSave} onClose={onClose} />);
  fireEvent.change(screen.getByRole('textbox', { name: "What's happening?" }), { target: { value: 'x' } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  });
  expect(screen.getByRole('alert').textContent).toBe('Status emoji must be a single emoji');
  expect(onClose).not.toHaveBeenCalled();
});

test('the footer shows your custom status, and the menu offers to set one', () => {
  const onEditStatus = vi.fn();
  render(
    <UserFooter user="sandy" status="open" presence="online" statusText="Deep work" statusEmoji="🎧"
      onSetPresence={() => {}} onEditStatus={onEditStatus} onOpenProfile={() => {}} onLogout={() => {}} />
  );
  expect(screen.getByText('🎧 Deep work')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Set status/ }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Set a custom status' }));
  expect(onEditStatus).toHaveBeenCalled();
});

test("members show each other's status as plain text (no HTML, no markdown)", () => {
  const members = [
    { username: 'ann', role: 'owner', status: 'online', online: true, statusText: '<b>hi</b> **there**', statusEmoji: '👋' },
    { username: 'ben', role: 'member', status: 'online', online: true, statusText: null, statusEmoji: null },
  ];
  const { container } = render(
    <MemberList space="S" members={members} currentUser="ben" myRole="member" onMessageUser={() => {}} onSetRole={() => {}} onKick={() => {}} open onClose={() => {}} />
  );
  expect(screen.getByText('👋 <b>hi</b> **there**')).toBeTruthy();
  expect(container.querySelector('b')).toBeNull();
});
