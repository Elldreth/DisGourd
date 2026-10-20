// P3-26d: the slow mode countdown store, the composer while counting down,
// the Slow mode choice in channel settings, and the log sentence.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';

vi.mock('../api.js', () => ({
  getChannelOverrides: vi.fn(async () => ({ overrides: [] })),
  setChannelOverrides: vi.fn(async () => ({ overrides: [] })),
  setChannelNsfw: vi.fn(async () => ({})),
  setChannelTopic: vi.fn(async () => ({})),
  setChannelSlowmode: vi.fn(async () => ({})),
}));
const api = await import('../api.js');
const { cooldownKey, cooldownLeft, startCooldown, useCooldown, clearCooldowns } = await import('../slowmode.js');
const { default: Composer } = await import('./Composer.jsx');
const { default: ChannelSettingsDialog } = await import('./ChannelSettingsDialog.jsx');
const { describeEntry } = await import('./server-settings/ModLogSection.jsx');

beforeEach(() => {
  vi.clearAllMocks();
  clearCooldowns();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

test('countdowns are per channel, in whole seconds, and run out', () => {
  vi.useFakeTimers();
  const k = cooldownKey('Tx', 'general');
  startCooldown(k, 30_000);
  expect(cooldownLeft(k)).toBe(30);
  expect(cooldownLeft(cooldownKey('Tx', 'random'))).toBe(0);
  vi.advanceTimersByTime(29_500);
  expect(cooldownLeft(k)).toBe(1);
  vi.advanceTimersByTime(600);
  expect(cooldownLeft(k)).toBe(0);
});

test('useCooldown re-renders as it counts down, and when one starts', () => {
  vi.useFakeTimers();
  const k = cooldownKey('Tx', 'general');
  const { result } = renderHook(() => useCooldown(k));
  expect(result.current).toBe(0);
  act(() => startCooldown(k, 3000));
  expect(result.current).toBe(3);
  act(() => {
    vi.advanceTimersByTime(1100);
  });
  expect(result.current).toBe(2);
  act(() => {
    vi.advanceTimersByTime(2000);
  });
  expect(result.current).toBe(0);
});

test('while counting down, the composer keeps the text and shows the seconds instead of Send', () => {
  const onSend = vi.fn();
  render(<Composer channel="general" onSend={onSend} cooldown={23} />);
  const box = screen.getByRole('textbox', { name: 'Message #general' });
  fireEvent.change(box, { target: { value: 'too soon' } });
  const button = screen.getByRole('button', { name: 'Slow mode: 23 seconds' });
  expect(button.disabled).toBe(true);
  expect(button.textContent).toContain('23 s');
  fireEvent.keyDown(box, { key: 'Enter' });
  expect(onSend).not.toHaveBeenCalled();
  expect(box.value).toBe('too soon');
  cleanup();
  render(<Composer channel="general" onSend={onSend} cooldown={0} />);
  expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy();
});

const roles = [{ id: 1, name: '@everyone', color: null, position: 0, isDefault: true }];

test('channel settings: Slow mode is saved only when it changed, and not offered for voice', async () => {
  render(<ChannelSettingsDialog space="Tx" channel="general" meta={{ type: 'text', slowmode: 30 }} roles={roles} isOwner onClose={() => {}} onSaved={() => {}} />);
  const select = await screen.findByLabelText('Slow mode');
  expect(select.value).toBe('30');
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(api.setChannelOverrides).toHaveBeenCalled());
  expect(api.setChannelSlowmode).not.toHaveBeenCalled();
  cleanup();
  render(<ChannelSettingsDialog space="Tx" channel="general" meta={{ type: 'text', slowmode: 30 }} roles={roles} isOwner onClose={() => {}} onSaved={() => {}} />);
  fireEvent.change(await screen.findByLabelText('Slow mode'), { target: { value: '0' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(api.setChannelSlowmode).toHaveBeenCalledWith('Tx', 'general', 0));
  cleanup();
  render(<ChannelSettingsDialog space="Tx" channel="lounge" meta={{ type: 'voice' }} roles={roles} isOwner onClose={() => {}} onSaved={() => {}} />);
  await screen.findByLabelText('@everyone: see and join');
  expect(screen.queryByLabelText('Slow mode')).toBeNull();
});

test('slow mode changes read as sentences in the moderation log', () => {
  const text = (e) => render(<div>{describeEntry(e)}</div>).container.textContent;
  expect(text({ action: 'slowmode', actor: 'sandy', details: { channel: 'general', seconds: 30 } })).toBe('sandy set slow mode in #general to 30 seconds');
  expect(text({ action: 'slowmode', actor: 'sandy', details: { channel: 'general', seconds: 0 } })).toBe('sandy turned off slow mode in #general');
});
