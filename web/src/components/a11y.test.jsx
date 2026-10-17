import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { computeAccessibleName } from 'dom-accessibility-api';

vi.mock('../audio.js', async (orig) => ({ ...(await orig()), displayCaptureSupported: () => true }));

import IconButton from './IconButton.jsx';
import ChannelList from './ChannelList.jsx';
import ServerRail from './ServerRail.jsx';
import ChatPanel from './ChatPanel.jsx';
import DmPanel from './DmPanel.jsx';
import DmSidebar from './DmSidebar.jsx';
import ProfileDialog from './ProfileDialog.jsx';
import { unreadLabel } from '../util.js';

afterEach(cleanup);

// Every button and form control has a real name: one that doesn't come from
// a hover-only `title`, and isn't just a symbol like "✕".
function expectNamedControls(root = document.body) {
  const unnamed = [];
  for (const el of root.querySelectorAll('button, input:not([type=hidden]), select, textarea, [role=button]')) {
    if (el.hidden || el.closest('[hidden]')) continue;
    const title = el.getAttribute('title');
    el.removeAttribute('title');
    const name = computeAccessibleName(el);
    if (title !== null) el.setAttribute('title', title);
    if (!/\p{L}/u.test(name)) unnamed.push(el.outerHTML.slice(0, 120));
  }
  expect(unnamed).toEqual([]);
}

test('IconButton: a named button with a hidden icon and an optional pressed state', () => {
  const onClick = vi.fn();
  render(
    <>
      <IconButton icon="search" label="Search messages" onClick={onClick} className="p-1" />
      <IconButton icon="mic" label="Mute" pressed={false} />
      <IconButton icon="mic" label="Unmute" pressed />
    </>
  );
  const search = screen.getByRole('button', { name: 'Search messages' });
  expect(search.getAttribute('type')).toBe('button');
  expect(search.getAttribute('title')).toBe('Search messages');
  expect(search.getAttribute('aria-pressed')).toBe(null);
  expect(search.className).toBe('p-1');
  expect(search.querySelector('svg').getAttribute('aria-hidden')).toBe('true');
  fireEvent.click(search);
  expect(onClick).toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Mute' }).getAttribute('aria-pressed')).toBe('false');
  expect(screen.getByRole('button', { name: 'Unmute' }).getAttribute('aria-pressed')).toBe('true');
});

test('unreadLabel says what a badge means', () => {
  expect(unreadLabel({})).toBe('');
  expect(unreadLabel({ unread: 3 })).toBe('3 unread');
  expect(unreadLabel({ mentions: 1 })).toBe('1 mention');
  expect(unreadLabel({ unread: 5, mentions: 2 })).toBe('5 unread, 2 mentions');
});

const channelProps = {
  space: 'Tx Check',
  channels: ['general', 'random'],
  currentChannel: 'general',
  unread: { random: 4 },
  mentions: { random: 1 },
  voiceChannels: ['Lounge'],
  voiceParticipants: { Lounge: [{ username: 'sandy', id: 1 }] },
  activeVoiceParticipants: [
    { username: 'sandy', id: 1 },
    { username: 'bob', id: 2, sharing: true, shareMutedLocally: false },
  ],
  canManage: true,
  isOwner: true,
  role: 'owner',
  user: 'sandy',
  status: 'open',
  selfId: 1,
};

test('ChannelList in a call: everything is named, toggles say whether they are on', () => {
  render(
    <ChannelList
      {...channelProps}
      myVoice={{ space: 'Tx Check', channel: 'Lounge' }}
      voiceStatus="connected"
      voiceMuted
      voiceDeafened={false}
      voiceCameraOn={false}
      voiceScreenOn
      voiceSharing={false}
    />
  );
  expectNamedControls();
  expect(screen.getByRole('button', { name: 'Mute (Ctrl+Shift+M)' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('button', { name: /Mute bob.s audio for me/ }).getAttribute('aria-pressed')).toBe('false');
  expect(screen.getByRole('button', { name: /^Deafen/ }).getAttribute('aria-pressed')).toBe('false');
  expect(screen.getByRole('button', { name: 'Camera' }).getAttribute('aria-pressed')).toBe('false');
  expect(screen.getByRole('button', { name: 'Share your screen' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('button', { name: /Share app audio/ }).getAttribute('aria-pressed')).toBe('false');
  expect(screen.getByRole('button', { name: /random.*4 unread, 1 mention/ })).toBeTruthy();
});

test('ChannelList: the channel settings gear can be reached by keyboard, not only on hover', () => {
  render(<ChannelList {...channelProps} />);
  const gears = screen.getAllByRole('button', { name: /^Channel settings/ });
  expect(gears.length).toBe(3); // two text channels + one voice channel
  for (const g of gears) expect(g.className).toMatch(/focus-visible:flex/);
  // The row reveals it while anything in the row has keyboard focus.
  for (const g of gears) expect(g.className).toMatch(/group-focus-within:flex/);
  // While its dialog is open the gear stays shown, so closing it can put focus back.
  const gear = screen.getByRole('button', { name: 'Channel settings for random' });
  expect(gear.className.split(' ')).toContain('hidden');
  fireEvent.click(gear);
  expect(gear.className.split(' ')).toContain('flex');
  expect(gear.className.split(' ')).not.toContain('hidden');
});

test('ChannelList voice notice: Dismiss is named in words', () => {
  render(<ChannelList {...channelProps} voiceNotice="You were disconnected" onDismissVoiceNotice={() => {}} />);
  expectNamedControls();
  expect(screen.getByRole('button', { name: 'Dismiss' })).toBeTruthy();
});

test('ServerRail: servers announce their full name and unread state', () => {
  render(
    <ServerRail
      spaces={[{ name: 'Tx Check', channels: ['general'] }, { name: 'Smoke Test', channels: ['general'] }]}
      currentSpace="Smoke Test"
      unread={{ 'Tx Check': 2 }}
      mentions={{ 'Tx Check': 1 }}
      dmUnread={3}
    />
  );
  expectNamedControls();
  expect(screen.getByRole('button', { name: 'Tx Check, 2 unread, 1 mention' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Smoke Test' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Direct Messages, 3 unread' })).toBeTruthy();
});

test('ChatPanel and DmPanel headers are named', () => {
  render(
    <ChatPanel space="Tx Check" channel="general" status="open" canPost messages={[]} currentUser="sandy" typingUsers={[]} memberNames={[]}
      onOpenNav={() => {}} onOpenSearch={() => {}} onOpenMembers={() => {}} />
  );
  expectNamedControls();
  cleanup();
  render(<DmPanel username={null} onOpenNav={() => {}} />);
  expectNamedControls();
  cleanup();
  render(<DmPanel username="bob" messages={[]} currentUser="sandy" typing={[]} onOpenNav={() => {}} onOpenSearch={() => {}} />);
  expectNamedControls();
  expect(screen.getByRole('button', { name: 'Conversations' })).toBeTruthy();
});

test('DmSidebar: a conversation announces its unread count', () => {
  render(<DmSidebar conversations={[{ username: 'bob' }]} unread={{ bob: 2 }} user="sandy" status="open" />);
  expectNamedControls();
  expect(screen.getByRole('button', { name: /bob.*2 unread/ })).toBeTruthy();
});

test('Settings: Upload avatar is a real button that opens the file picker', () => {
  render(<ProfileDialog profile={{ username: 'sandy', email: 's@example.test' }} onClose={() => {}} onUpdated={() => {}} />);
  const upload = screen.getByRole('button', { name: 'Upload avatar' });
  const input = document.querySelector('input[type=file]');
  const click = vi.spyOn(input, 'click');
  fireEvent.click(upload);
  expect(click).toHaveBeenCalled();
});
