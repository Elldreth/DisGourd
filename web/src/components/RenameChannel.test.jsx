// P6-03: rename a channel — a Name field in Channel settings › Overview, the
// counts and open channel following a rename, and the mod log entry.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';

vi.mock('../api.js', () => ({
  getChannelOverrides: vi.fn(async () => ({ overrides: [] })),
  setChannelOverrides: vi.fn(async () => ({ overrides: [] })),
  setChannelNsfw: vi.fn(async () => ({})),
  setChannelTopic: vi.fn(async () => ({})),
  setChannelSlowmode: vi.fn(async () => ({})),
  renameChannel: vi.fn(async () => ({})),
  deleteChannel: vi.fn(),
  getMessages: vi.fn(async () => []),
}));
const api = await import('../api.js');
const { default: ChannelSettingsDialog } = await import('./ChannelSettingsDialog.jsx');
const { describeEntry } = await import('./server-settings/ModLogSection.jsx');
const { useChannelMessages, unreadKey } = await import('../state/useChannelMessages.js');

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const roles = [{ id: 1, name: '@everyone', color: null, position: 0, isDefault: true }];
async function dialog(meta = { type: 'text', topic: 'Old topic' }) {
  const onSaved = vi.fn();
  render(<ChannelSettingsDialog space="Tx" channel="general" meta={meta} roles={roles} isOwner onClose={() => {}} onSaved={onSaved} />);
  await screen.findByLabelText('@everyone: view');
  return onSaved;
}
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }));

test('Overview has the name; unchanged, nothing is renamed', async () => {
  await dialog();
  expect(screen.getByLabelText('Name').value).toBe('general');
  save();
  await waitFor(() => expect(api.setChannelOverrides).toHaveBeenCalled());
  expect(api.renameChannel).not.toHaveBeenCalled();
});

test('a new name is shown as it will be saved, and renamed after the other changes', async () => {
  const onSaved = await dialog();
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Game Night!' } });
  expect(screen.getByText(/Saved as #game-night/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Topic'), { target: { value: 'Fridays' } });
  save();
  await waitFor(() => expect(api.renameChannel).toHaveBeenCalledWith('Tx', 'general', 'game-night'));
  // The topic went to the old name, before the rename.
  expect(api.setChannelTopic).toHaveBeenCalledWith('Tx', 'general', 'Fridays');
  expect(api.setChannelTopic.mock.invocationCallOrder[0]).toBeLessThan(api.renameChannel.mock.invocationCallOrder[0]);
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
});

test('an empty name is refused before anything is saved; a server refusal is shown', async () => {
  await dialog();
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: ' !! ' } });
  save();
  expect(screen.getByText('A channel name is required')).toBeTruthy();
  expect(api.setChannelOverrides).not.toHaveBeenCalled();
  api.renameChannel.mockRejectedValueOnce(new Error('A channel with that name already exists'));
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'random' } });
  save();
  expect(await screen.findByText('A channel with that name already exists')).toBeTruthy();
});

test('unread, mentions and thread parents move to the new name', async () => {
  const { result } = renderHook(() => useChannelMessages({ space: 'S', channel: 'other', active: true, user: 'sandy', send: vi.fn(), status: 'open' }));
  act(() => {
    result.current.handlers.unread({
      counts: [{ space: 'S', channel: 'general', count: 3 }, { space: 'T', channel: 'general', count: 1 }],
      mentions: [{ space: 'S', channel: 'general', count: 1 }],
      threads: [{ space: 'S', channel: '~t5', parent: 'general', name: 'Plans' }, { space: 'T', channel: '~t6', parent: 'general', name: 'Elsewhere' }],
    });
  });
  act(() => result.current.handlers.channel_renamed({ space: 'S', channel: 'general', newName: 'game-night' }));
  expect(result.current.unread).toEqual({ [unreadKey('S', 'game-night')]: 3, [unreadKey('T', 'general')]: 1 });
  expect(result.current.mentions).toEqual({ [unreadKey('S', 'game-night')]: 1 });
  expect(result.current.threads[unreadKey('S', '~t5')].parent).toBe('game-night');
  expect(result.current.threads[unreadKey('T', '~t6')].parent).toBe('general'); // another server's #general
});

test('the mod log says who renamed what', () => {
  render(<p>{describeEntry({ action: 'channel_rename', actor: 'sandy', details: { from: 'general', to: 'game-night' } })}</p>);
  expect(screen.getByText(/renamed #general to #game-night/).textContent).toBe('sandy renamed #general to #game-night');
});
