// P5-06: the one-line microphone warning with "Why?", and the Image
// generation Overview's "not set up" illustration.
import { afterEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../api.js', () => ({
  getImagineSettings: vi.fn(),
  saveImagineSettings: vi.fn(),
  testComfyUI: vi.fn(),
  testKie: vi.fn(),
  tryImagine: vi.fn(),
}));
const api = await import('../api.js');
const { default: ChannelList } = await import('./ChannelList.jsx');
const { default: ImagineAllPages } = await import('./admin/imagine/allPages.testutil.jsx');

afterEach(cleanup);

test('no microphone: one short line, and "Why?" opens Settings at Voice & audio', () => {
  const onOpenProfile = vi.fn();
  render(
    <ChannelList
      space="S" channels={['general']} currentChannel="general" voiceChannels={['Lounge']} voiceParticipants={{}} activeVoiceParticipants={[]}
      myVoice={{ space: 'S', channel: 'Lounge' }} voiceStatus="connected" voiceMicError="blocked"
      user="sandy" status="open" selfId={1} onSelect={() => {}} onOpenProfile={onOpenProfile} channelMeta={{ general: { type: 'text' }, Lounge: { type: 'voice' } }}
    />
  );
  const line = screen.getByText('No microphone: listening only.');
  expect(line.className).toMatch(/\btruncate\b/);
  fireEvent.click(screen.getByRole('button', { name: 'Why?' }));
  expect(onOpenProfile).toHaveBeenCalledWith('audio');
});

const view = (comfy = {}, kie = null) => ({
  defaultEngine: null, permissive: false, dailyLimit: 20, dailyCeiling: 100,
  engines: [
    { id: 'comfyui', name: 'ComfyUI (local)', config: { enabled: false, url: '', model: null, family: null, tier: 'medium', ...comfy } },
    ...(kie ? [{ id: 'kie', name: 'kie.ai', models: [], config: { enabled: false, model: null, customModel: '', monthlyCredits: null, ...kie } }] : []),
  ],
});

test('Overview shows the "not set up" art while no engine is on, and its button opens ComfyUI', async () => {
  api.getImagineSettings.mockResolvedValue(view());
  const onNavigate = vi.fn();
  await act(async () => {
    render(<ImagineAllPages onNavigate={onNavigate} />);
  });
  expect(await screen.findByText('Image generation isn’t set up yet')).toBeTruthy();
  expect(document.querySelector('svg[data-art="imagine"]')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Set up ComfyUI' }));
  expect(onNavigate).toHaveBeenCalledWith('imagine-comfy');
  cleanup();
  api.getImagineSettings.mockResolvedValue(view({ enabled: true, url: '', model: 'm' }));
  await act(async () => {
    render(<ImagineAllPages />);
  });
  await waitFor(() => expect(screen.getByLabelText('Images per person per day')).toBeTruthy());
  expect(screen.queryByText('Image generation isn’t set up yet')).toBeNull();
});
