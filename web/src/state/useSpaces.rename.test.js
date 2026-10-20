// P6-03: when the channel you're in is renamed, you move to the new name, not
// to the server's first channel (the "channel gone" fallback must not fire).
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

const space = (channels, meta) => ({ name: 'Tx', role: 'member', owner: false, abilities: [], channels, voiceChannels: ['lounge'], channelMeta: meta, categories: [] });
const before = space(['general', 'history'], { general: { type: 'text' }, history: { type: 'text', topic: 'Notes' }, lounge: { type: 'voice' } });
const after = space(['general', 'testing-notes'], { general: { type: 'text' }, 'testing-notes': { type: 'text', topic: 'Notes' }, lounge: { type: 'voice' } });

vi.mock('../api.js', () => ({
  getSpaces: vi.fn(),
  getMembers: vi.fn(async () => ({ members: [] })),
  getRoles: vi.fn(async () => ({ roles: [] })),
}));
const api = await import('../api.js');
const { useSpaces } = await import('./useSpaces.js');
const { renameChannelIn } = await import('../util.js');

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('disgourd.view.7', JSON.stringify({ view: 'server', space: 'Tx', channel: 'history' }));
});
afterEach(cleanup);

test('renameChannelIn renames the channel, its meta, and nothing else', () => {
  const next = renameChannelIn(before, 'history', 'testing-notes');
  expect(next.channels).toEqual(['general', 'testing-notes']);
  expect(next.channelMeta['testing-notes']).toBe(before.channelMeta.history);
  expect(next.channelMeta.history).toBeUndefined();
  expect(renameChannelIn(before, 'lounge', 'hangout').voiceChannels).toEqual(['hangout']);
});

test('the open channel follows a rename, before and after the list reloads', async () => {
  api.getSpaces.mockResolvedValueOnce([before]);
  const { result } = renderHook(() => useSpaces({ token: 't', myId: 7, status: 'open', view: 'server', onRestoreDm: () => {} }));
  await waitFor(() => expect(result.current.currentChannel).toBe('history'));

  let reload;
  api.getSpaces.mockReturnValueOnce(new Promise((r) => { reload = () => r([after]); }));
  act(() => result.current.handlers.channel_renamed({ space: 'Tx', channel: 'history', newName: 'testing-notes' }));
  expect(result.current.currentChannel).toBe('testing-notes');
  expect(result.current.channels).toEqual(['general', 'testing-notes']);
  await act(async () => reload());
  expect(result.current.currentChannel).toBe('testing-notes');
});

test("someone in another channel stays where they are", async () => {
  localStorage.setItem('disgourd.view.7', JSON.stringify({ view: 'server', space: 'Tx', channel: 'general' }));
  api.getSpaces.mockResolvedValueOnce([before]).mockResolvedValueOnce([after]);
  const { result } = renderHook(() => useSpaces({ token: 't', myId: 7, status: 'open', view: 'server', onRestoreDm: () => {} }));
  await waitFor(() => expect(result.current.currentChannel).toBe('general'));
  await act(async () => result.current.handlers.channel_renamed({ space: 'Tx', channel: 'history', newName: 'testing-notes' }));
  expect(result.current.currentChannel).toBe('general');
});
