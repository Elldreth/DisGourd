// P3-20a: channel topics — set in Channel settings, shown in the header
// (expand / collapse) and on the channel's welcome card.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../api.js', () => ({
  getChannelOverrides: vi.fn(async () => ({ overrides: [] })),
  setChannelOverrides: vi.fn(async () => ({ overrides: [] })),
  setChannelNsfw: vi.fn(async () => ({})),
  setChannelTopic: vi.fn(async () => ({})),
  deleteChannel: vi.fn(),
  getPins: vi.fn(async () => []),
  getThreads: vi.fn(async () => []),
}));
vi.mock('../audio.js', async (orig) => ({ ...(await orig()), displayCaptureSupported: () => true }));
const api = await import('../api.js');
const { default: ChannelSettingsDialog } = await import('./ChannelSettingsDialog.jsx');
const { default: ChatPanel } = await import('./ChatPanel.jsx');

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

const roles = [{ id: 1, name: '@everyone', color: null, position: 0, isDefault: true }];
const panel = (props = {}) =>
  render(
    <ChatPanel space="Tx" channel="general" status="open" canPost messages={[]} currentUser="sandy" typingUsers={[]} memberNames={[]}
      onOpenNav={() => {}} onOpenSearch={() => {}} onOpenMembers={() => {}} {...props} />
  );

test('channel settings: the topic is saved (trimmed) only when it changed, with a count', async () => {
  render(<ChannelSettingsDialog space="Tx" channel="general" meta={{ type: 'text', topic: 'Old topic' }} roles={roles} isOwner onClose={() => {}} onSaved={() => {}} />);
  await screen.findByLabelText('@everyone: view');
  const box = screen.getByLabelText('Topic');
  expect(box.value).toBe('Old topic');
  expect(screen.getByText('9/300')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(api.setChannelOverrides).toHaveBeenCalled());
  expect(api.setChannelTopic).not.toHaveBeenCalled();
  cleanup();
  render(<ChannelSettingsDialog space="Tx" channel="general" meta={{ type: 'text', topic: 'Old topic' }} roles={roles} isOwner onClose={() => {}} onSaved={() => {}} />);
  await screen.findByLabelText('@everyone: view');
  fireEvent.change(screen.getByLabelText('Topic'), { target: { value: '  Introduce yourself here.  ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(api.setChannelTopic).toHaveBeenCalledWith('Tx', 'general', 'Introduce yourself here.'));
});

test('the header shows the topic’s first line and expands it; Esc, a second click or a channel switch closes it', () => {
  const { rerender } = panel({ topic: 'Say hi!\nRules: be kind. See https://example.com/rules' });
  const button = screen.getByRole('button', { name: /Topic: Say hi!/ });
  expect(button.textContent).toBe('Say hi!');
  expect(button.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(button);
  const full = document.getElementById('channel-topic-full');
  expect(full.textContent).toContain('Rules: be kind.');
  expect(full.querySelector('a[href="https://example.com/rules"]')).toBeTruthy(); // links work
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(document.getElementById('channel-topic-full')).toBeNull();
  fireEvent.click(button);
  fireEvent.click(button);
  expect(document.getElementById('channel-topic-full')).toBeNull();
  fireEvent.click(button);
  rerender(
    <ChatPanel space="Tx" channel="random" status="open" canPost messages={[]} currentUser="sandy" typingUsers={[]} memberNames={[]}
      onOpenNav={() => {}} onOpenSearch={() => {}} onOpenMembers={() => {}} topic="Anything goes" />
  );
  expect(document.getElementById('channel-topic-full')).toBeNull();
});

test('the welcome card shows the topic; without one, no header button and the usual welcome', () => {
  panel({ topic: 'Introduce yourself here.' });
  expect(screen.getAllByText('Introduce yourself here.').length).toBeGreaterThanOrEqual(2); // header + welcome card
  cleanup();
  panel();
  expect(screen.queryByRole('button', { name: /^Topic:/ })).toBeNull();
  expect(screen.getByText('This is the start of the channel. Say hello! 👋')).toBeTruthy();
});
