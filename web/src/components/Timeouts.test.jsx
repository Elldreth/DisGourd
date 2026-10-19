// P3-26c: Time out… in the member menu, the ⏱ on timed-out members, the
// notice in place of the message box, and its return when the timeout ends.
import { afterEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import MemberList from './MemberList.jsx';
import TimedOutNotice, { timeoutEnd, useActiveTimeout } from './TimedOutNotice.jsx';
import { describeEntry } from './ModLogDialog.jsx';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const soon = Date.now() + 30 * 60e3;
const members = [
  { username: 'sandy', online: true, role: 'owner', position: 1e9 },
  { username: 'ada', online: true, role: 'admin', position: 2 },
  { username: 'bob', online: true, role: 'member', position: 0 },
  { username: 'cara', online: true, role: 'member', position: 0, timedOutUntil: soon },
];

function list(props) {
  return render(
    <MemberList space="Tx" members={members} currentUser="ada" myRole="admin" myPosition={2} onMessageUser={() => {}} onToggleRole={() => {}} onKick={() => {}} open {...props} />
  );
}
const openMenu = (name) => fireEvent.click(screen.getByTitle(name));

test('timed-out members show a ⏱ with the end time, for everyone', () => {
  list({});
  const badge = screen.getByRole('img', { name: /^Timed out until / });
  expect(badge.getAttribute('aria-label')).toBe(`Timed out until ${timeoutEnd(soon)}`);
  expect(screen.getAllByRole('img', { name: /^Timed out until / })).toHaveLength(1);
});

test('Time out… only with the permission and for people below me; Remove timeout for timed-out people', () => {
  const onRemoveTimeout = vi.fn();
  list({ canTimeoutMembers: false });
  openMenu('bob');
  expect(screen.queryByText('Time out…')).toBeNull();
  cleanup();
  list({ canTimeoutMembers: true, onRemoveTimeout });
  openMenu('sandy');
  expect(screen.queryByText('Time out…')).toBeNull();
  openMenu('bob');
  expect(screen.getByText('Time out…')).toBeTruthy();
  openMenu('cara');
  expect(screen.queryByText('Time out…')).toBeNull();
  fireEvent.click(screen.getByText('Remove timeout'));
  expect(onRemoveTimeout).toHaveBeenCalledWith('cara');
});

test('the Time out dialog sends the duration and reason, and shows refusals', async () => {
  const onTimeout = vi.fn(async () => {});
  list({ canTimeoutMembers: true, onTimeout });
  openMenu('bob');
  fireEvent.click(screen.getByText('Time out…'));
  expect(screen.getByRole('dialog', { name: 'Time out @bob in Tx?' })).toBeTruthy();
  expect(screen.getByRole('radio', { name: '1 hour' }).checked).toBe(true);
  fireEvent.click(screen.getByRole('radio', { name: '1 day' }));
  fireEvent.change(screen.getByLabelText('Reason (optional)'), { target: { value: ' cool off ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Time out' }));
  await waitFor(() => expect(onTimeout).toHaveBeenCalledWith('bob', { minutes: 1440, reason: 'cool off' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: /Time out @bob/ })).toBeNull());

  onTimeout.mockRejectedValueOnce(new Error('You cannot time out this member'));
  openMenu('bob');
  fireEvent.click(screen.getByText('Time out…'));
  fireEvent.click(screen.getByRole('button', { name: 'Time out' }));
  expect((await screen.findByRole('alert')).textContent).toBe('You cannot time out this member');
});

test('the notice says until when, with the reason; a later day shows the day', () => {
  render(<TimedOutNotice timeout={{ until: soon, reason: 'spam' }} />);
  const note = screen.getByRole('status');
  expect(note.textContent).toContain(`You’re timed out in this server until ${timeoutEnd(soon)}.`);
  expect(note.textContent).toContain('Reason: spam');
  const now = new Date(2026, 9, 19, 12, 0);
  expect(timeoutEnd(new Date(2026, 9, 19, 16, 30).getTime(), now)).not.toMatch(/Oct/);
  expect(timeoutEnd(new Date(2026, 9, 22, 16, 30).getTime(), now)).toMatch(/Oct/);
});

test('useActiveTimeout returns the timeout while it lasts and null once it ends', () => {
  vi.useFakeTimers();
  const t = { until: Date.now() + 5 * 60e3, reason: null };
  const { result, rerender } = renderHook(({ timeout }) => useActiveTimeout(timeout), { initialProps: { timeout: t } });
  expect(result.current).toBe(t);
  act(() => {
    vi.advanceTimersByTime(5 * 60e3 + 100);
  });
  expect(result.current).toBeNull();
  rerender({ timeout: null });
  expect(result.current).toBeNull();
  rerender({ timeout: { until: Date.now() - 1, reason: null } });
  expect(result.current).toBeNull();
});

test('timeout entries read as sentences in the moderation log', () => {
  const text = (e) => render(<div>{describeEntry(e)}</div>).container.textContent;
  expect(text({ action: 'timeout', actor: 'ada', target: 'bob', details: { minutes: 60 } })).toBe('ada timed out bob for 1 hour');
  expect(text({ action: 'timeout_remove', actor: 'ada', target: 'bob', details: null })).toBe('ada removed bob’s timeout');
});
