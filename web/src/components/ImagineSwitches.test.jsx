// P2-20d: the server's /imagine switch, the 18+ channel switch and tag, and
// bot messages in the list.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../api.js', () => ({
  setServerImagine: vi.fn(async () => ({})),
  setChannelNsfw: vi.fn(async () => ({})),
  getChannelOverrides: vi.fn(async () => ({ overrides: [] })),
  setChannelOverrides: vi.fn(async () => ({ overrides: [] })),
  deleteChannel: vi.fn(),
}));
vi.mock('../audio.js', async (orig) => ({ ...(await orig()), displayCaptureSupported: () => true }));
const api = await import('../api.js');
const { default: ServerImagineDialog } = await import('./ServerImagineDialog.jsx');
const { default: ChannelSettingsDialog } = await import('./ChannelSettingsDialog.jsx');
const { default: ChannelList } = await import('./ChannelList.jsx');
const { default: MessageList } = await import('./MessageList.jsx');

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = vi.fn(); // jsdom has none
});
afterEach(cleanup);

const info = (over = {}) => ({ serverEnabled: false, enabled: false, canUse: true, dailyLimit: 20, ownLimit: null, usedToday: 0, engines: [{ id: 'comfyui', name: 'ComfyUI (local)' }], ...over });

test('server dialog: turning /imagine on with a limit, and blank meaning the instance default', async () => {
  const onSaved = vi.fn();
  render(<ServerImagineDialog space="Tx" info={info()} onClose={() => {}} onSaved={onSaved} />);
  expect(screen.getByRole('dialog', { name: 'Image generation — Tx' })).toBeTruthy();
  expect(screen.getByLabelText('Images per person per day').getAttribute('placeholder')).toBe('Instance default (20)');
  fireEvent.click(screen.getByRole('checkbox', { name: /Allow \/imagine/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(api.setServerImagine).toHaveBeenCalledWith('Tx', { enabled: true, dailyLimit: null }));
  expect(onSaved).toHaveBeenCalled();
  cleanup();
  render(<ServerImagineDialog space="Tx" info={info({ serverEnabled: true, ownLimit: 5 })} onClose={() => {}} />);
  expect(screen.getByLabelText('Images per person per day').value).toBe('5');
  fireEvent.change(screen.getByLabelText('Images per person per day'), { target: { value: '8' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(api.setServerImagine).toHaveBeenLastCalledWith('Tx', { enabled: true, dailyLimit: 8 }));
});

test('server dialog: says so when the instance has no engine, and shows a save error', async () => {
  api.setServerImagine.mockRejectedValueOnce(new Error('The daily limit is 1–100'));
  render(<ServerImagineDialog space="Tx" info={info({ engines: [] })} onClose={() => {}} />);
  expect(screen.getByText(/No image engine is set up on this instance yet/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect((await screen.findByRole('alert')).textContent).toBe('The daily limit is 1–100');
});

test('channel settings: the 18+ switch is saved only when it changed, and not offered for voice', async () => {
  const roles = [{ id: 1, name: '@everyone', color: null, position: 0, isDefault: true }];
  render(<ChannelSettingsDialog space="Tx" channel="lounge" meta={{ type: 'text', nsfw: false }} roles={roles} isOwner onClose={() => {}} onSaved={() => {}} />);
  await screen.findByLabelText('@everyone: view');
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(api.setChannelOverrides).toHaveBeenCalled());
  expect(api.setChannelNsfw).not.toHaveBeenCalled();
  cleanup();
  render(<ChannelSettingsDialog space="Tx" channel="lounge" meta={{ type: 'text', nsfw: false }} roles={roles} isOwner onClose={() => {}} onSaved={() => {}} />);
  await screen.findByLabelText('@everyone: view');
  fireEvent.click(screen.getByRole('checkbox', { name: /Age-restricted \(18\+\)/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(api.setChannelNsfw).toHaveBeenCalledWith('Tx', 'lounge', true));
  cleanup();
  render(<ChannelSettingsDialog space="Tx" channel="Voice" meta={{ type: 'voice' }} roles={roles} isOwner onClose={() => {}} onSaved={() => {}} />);
  await screen.findByLabelText('@everyone: see and join');
  expect(screen.queryByRole('checkbox', { name: /Age-restricted/ })).toBeNull();
});

test('channel list: an 18+ tag on marked channels; Image generation in the server menu for managers', () => {
  render(
    <ChannelList
      space="S" channels={['general', 'after-dark']} currentChannel="general" voiceChannels={[]} voiceParticipants={{}} activeVoiceParticipants={[]}
      user="sandy" status="open" selfId={1} onSelect={() => {}} canManage isOwner role="owner" onInvite={() => {}}
      channelMeta={{ general: { type: 'text' }, 'after-dark': { type: 'text', nsfw: true } }} imagineInfo={info()}
    />
  );
  expect(screen.getByRole('button', { name: /^after-dark/ }).textContent).toContain('18+');
  expect(screen.getByRole('button', { name: /^general/ }).textContent).not.toContain('18+');
  // P3-22: managers' rows make room for the gear when it shows, so it can't cover the 18+ tag.
  expect(screen.getByRole('button', { name: /^after-dark/ }).className).toMatch(/group-hover:pr-8/);
  fireEvent.click(screen.getByRole('button', { name: 'Channel settings for after-dark' }));
  expect(screen.getByRole('button', { name: /^after-dark/ }).className).toMatch(/(^| )pr-8( |$)/);
  fireEvent.keyDown(document.activeElement, { key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: /^S$|S$/ }));
  fireEvent.click(screen.getByRole('button', { name: /Image generation/ }));
  expect(screen.getByRole('dialog', { name: 'Image generation — S' })).toBeTruthy();
});

const msg = (id, extra = {}) => ({ id, author: 'sandy', content: `m${id}`, timestamp: 1700000000000 + id * 1000, reactions: [], ...extra });

test('bot messages carry a BOT badge', () => {
  render(<MessageList messages={[msg(1), msg(2, { author: 'Imagine', bot: true, content: '🎨 **sandy** imagined: a cat' })]} channel="general" currentUser="sandy" />);
  const rows = screen.getAllByRole('article');
  expect(rows[1].textContent).toContain('BOT');
  expect(rows[0].textContent).not.toContain('BOT');
});

test('an image finishing loading keeps the list at the bottom only if you were there', () => {
  const { container } = render(
    <MessageList messages={[msg(1), msg(2, { author: 'Imagine', bot: true, attachments: ['/uploads/x/imagine-1.png'], attachment: '/uploads/x/imagine-1.png' })]} channel="general" currentUser="sandy" />
  );
  const scroller = container.querySelector('.overflow-y-auto');
  const img = container.querySelector('img[src*="imagine-1"]');
  expect(img).toBeTruthy();
  const at = (top) => {
    Object.defineProperty(scroller, 'scrollHeight', { value: 2000, configurable: true });
    Object.defineProperty(scroller, 'clientHeight', { value: 500, configurable: true });
    scroller.scrollTop = top;
    fireEvent.scroll(scroller);
  };
  at(1500); // at the bottom
  Element.prototype.scrollIntoView.mockClear();
  img.dispatchEvent(new Event('load'));
  expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'end' });
  at(200); // scrolled up to read
  Element.prototype.scrollIntoView.mockClear();
  img.dispatchEvent(new Event('load'));
  expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
});
