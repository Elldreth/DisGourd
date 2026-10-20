// P6-01: "Leave server" at the bottom of the server menu, for members (never the
// owner), behind a danger confirmation.
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../api.js', () => ({}));
const { default: ChannelList } = await import('./ChannelList.jsx');

afterEach(cleanup);

function list(props = {}) {
  return render(
    <ChannelList
      space="Tx" channels={['general']} currentChannel="general" voiceChannels={[]} voiceParticipants={{}} activeVoiceParticipants={[]}
      user="bob" status="open" selfId={2} onSelect={() => {}} onInvite={() => {}} channelMeta={{ general: { type: 'text' } }}
      role="member" abilities={[]}
      {...props}
    />
  );
}
const openMenu = () => fireEvent.click(screen.getByRole('button', { name: 'Tx' }));
const menuItems = () => [...screen.getByRole('button', { name: /Invite people/ }).parentElement.querySelectorAll('button')];

test('a member sees Leave server last, in red; the owner does not see it', () => {
  list({ onLeaveServer: () => {} });
  openMenu();
  const items = menuItems();
  expect(items.map((b) => b.textContent.trim())).toEqual(['Invite people', 'Leave server']);
  expect(items.at(-1).className).toContain('text-danger');
  cleanup();
  list({ isOwner: true, role: 'owner', canManage: true, onLeaveServer: () => {} });
  openMenu();
  expect(screen.queryByRole('button', { name: /Leave server/ })).toBeNull();
});

test('cancelling the confirmation does nothing; confirming leaves', () => {
  const onLeaveServer = vi.fn();
  list({ onLeaveServer });
  openMenu();
  fireEvent.click(screen.getByRole('button', { name: /Leave server/ }));
  const dialog = screen.getByRole('dialog', { name: 'Leave Tx?' });
  expect(dialog.textContent).toMatch(/new invite/);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(onLeaveServer).not.toHaveBeenCalled();

  openMenu();
  fireEvent.click(screen.getByRole('button', { name: /Leave server/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Leave server' }));
  expect(onLeaveServer).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('dialog')).toBeNull();
});
