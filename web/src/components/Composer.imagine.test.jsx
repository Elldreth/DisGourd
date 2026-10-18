// P2-20d: /imagine in the message box, and the hook behind it.
import { afterEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import Composer from './Composer.jsx';
import { imagineFor, imagineState } from './ImaginePanel.jsx';
import { useImagine } from '../state/useImagine.js';

afterEach(cleanup);

const info = (over = {}) => ({ serverEnabled: true, enabled: true, canUse: true, dailyLimit: 5, usedToday: 2, engines: [{ id: 'comfyui', name: 'ComfyUI (local)' }], ...over });
function setup({ imagine = imagineState(info(), vi.fn(async () => ({ jobId: 1 }))), onSend = vi.fn() } = {}) {
  render(<Composer channel="general" onSend={onSend} imagine={imagine} />);
  const box = screen.getByRole('textbox', { name: 'Message #general' });
  const type = (value) => fireEvent.change(box, { target: { value } });
  return { box, type, onSend, imagine };
}

test('typing "/" suggests /imagine; picking it fills the box', () => {
  const { box, type } = setup();
  type('/');
  fireEvent.mouseDown(screen.getByRole('button', { name: '/imagine — generate an image' }));
  expect(box.value).toBe('/imagine ');
  expect(screen.getByRole('region', { name: 'Image options' })).toBeTruthy();
  type('/im');
  fireEvent.keyDown(box, { key: 'Enter' });
  expect(box.value).toBe('/imagine ');
});

test('Enter sends the request with the chosen options, not a message, and clears the box', async () => {
  const { box, type, onSend, imagine } = setup();
  type('/imagine a cat in a hat');
  const panel = screen.getByRole('region', { name: 'Image options' });
  expect(within(panel).getByText('3 left today')).toBeTruthy();
  expect(within(panel).queryByRole('group', { name: 'Engine' })).toBeNull(); // only one engine
  fireEvent.click(within(panel).getByRole('button', { name: 'Landscape' }));
  fireEvent.click(within(panel).getByRole('button', { name: 'High' }));
  expect(within(panel).getByRole('button', { name: 'Landscape' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.keyDown(box, { key: 'Enter' });
  await waitFor(() => expect(imagine.run).toHaveBeenCalledWith({ prompt: 'a cat in a hat', shape: 'landscape', quality: 'high' }));
  await waitFor(() => expect(box.value).toBe(''));
  expect(onSend).not.toHaveBeenCalled();
});

test('a refusal keeps the text and shows the reason; an empty prompt is caught first', async () => {
  const run = vi.fn(async () => {
    throw Object.assign(new Error('You’ve used all 5 images for today'), { code: 'LIMIT' });
  });
  const { box, type } = setup({ imagine: imagineState(info(), run) });
  type('/imagine');
  fireEvent.keyDown(box, { key: 'Enter' });
  expect(screen.getByRole('alert').textContent).toBe('Describe the image after /imagine');
  expect(run).not.toHaveBeenCalled();
  type('/imagine a dog');
  fireEvent.keyDown(box, { key: 'Enter' });
  expect((await screen.findByRole('alert')).textContent).toBe('You’ve used all 5 images for today');
  expect(box.value).toBe('/imagine a dog');
});

test('when /imagine can’t be used here, the panel says why and nothing is sent', () => {
  for (const [over, reason] of [
    [{ serverEnabled: false }, /off in this server/],
    [{ engines: [] }, /No image engine/],
    [{ canUse: false }, /Generate images permission/],
    [{ usedToday: 5 }, /used all 5 images/],
  ]) {
    const run = vi.fn();
    const { box, type, onSend } = setup({ imagine: imagineState(info(over), run) });
    type('/');
    expect(screen.queryByRole('button', { name: /generate an image/ })).toBeNull(); // not suggested
    type('/imagine a cat');
    expect(within(screen.getByRole('region', { name: 'Image options' })).getByText(reason)).toBeTruthy();
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(run).not.toHaveBeenCalled();
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getAllByText(reason)).toHaveLength(1); // said once, not repeated as an error
    cleanup();
  }
});

test('with two engines the panel offers the choice', async () => {
  const run = vi.fn(async () => ({}));
  const { box, type } = setup({ imagine: imagineState(info({ engines: [{ id: 'comfyui', name: 'ComfyUI' }, { id: 'kie', name: 'kie.ai' }] }), run) });
  type('/imagine a boat');
  fireEvent.click(within(screen.getByRole('group', { name: 'Engine' })).getByRole('button', { name: 'kie.ai' }));
  fireEvent.keyDown(box, { key: 'Enter' });
  await waitFor(() => expect(run).toHaveBeenCalledWith({ prompt: 'a boat', shape: 'square', quality: 'standard', engine: 'kie' }));
});

test('without /imagine info the box behaves as before ("/imagine" is just text)', () => {
  const onSend = vi.fn();
  const { box, type } = setup({ imagine: null, onSend });
  type('/imagine hello');
  expect(screen.queryByRole('region', { name: 'Image options' })).toBeNull();
  fireEvent.keyDown(box, { key: 'Enter' });
  expect(onSend).toHaveBeenCalledWith('/imagine hello', [], false);
});

test('useImagine: answers match requests in order; other error frames are ignored', async () => {
  const send = vi.fn();
  const onQueued = vi.fn();
  const { result } = renderHook(() => useImagine({ send, onQueued }));
  let first;
  let second;
  act(() => {
    first = result.current.imagine({ prompt: 'one' });
    second = result.current.imagine({ prompt: 'two' });
  });
  expect(send).toHaveBeenCalledWith({ op: 'imagine', prompt: 'one' });
  act(() => {
    result.current.handlers.error({ type: 'error', op: 'message', error: 'nope' }); // not ours
    result.current.handlers.imagine_queued({ type: 'imagine_queued', jobId: 7, messageId: 70 });
    result.current.handlers.error({ type: 'error', op: 'imagine', code: 'LIMIT', error: 'Limit reached' });
  });
  await expect(first).resolves.toMatchObject({ jobId: 7 });
  await expect(second).rejects.toMatchObject({ message: 'Limit reached', code: 'LIMIT' });
  expect(onQueued).toHaveBeenCalledTimes(1);
});

test('imagineFor sends the request to that server and channel (or thread)', async () => {
  const request = vi.fn(async () => ({ jobId: 3 }));
  const spaces = [{ name: 'Tx', imagine: info() }, { name: 'Other' }];
  const state = imagineFor(spaces, 'Tx', '~t42', request);
  expect(state.available).toBe(true);
  await state.run({ prompt: 'a cat', shape: 'square', quality: 'draft' });
  expect(request).toHaveBeenCalledWith({ space: 'Tx', channel: '~t42', prompt: 'a cat', shape: 'square', quality: 'draft' });
  expect(imagineFor(spaces, 'Other', 'general', request)).toBeNull(); // a server without /imagine info
});
