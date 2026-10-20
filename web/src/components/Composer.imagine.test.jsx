// P2-20d: /imagine in the message box, and the hook behind it.
import { afterEach, expect, test, vi } from 'vitest';
vi.mock('../api.js', async (orig) => ({ ...(await orig()), uploadFile: vi.fn(async (file) => ({ url: `/uploads/abc/${encodeURIComponent(file.name)}` })) }));
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

test('a paid engine shows its price for the chosen quality', () => {
  const engines = [
    { id: 'comfyui', name: 'ComfyUI' },
    { id: 'kie', name: 'kie.ai', price: { draft: { credits: 0.8, estimate: true }, standard: { credits: 0.8, estimate: true }, high: { credits: 5.5, estimate: false } } },
  ];
  const { type } = setup({ imagine: imagineState(info({ engines }), vi.fn()) });
  type('/imagine a fox');
  const panel = screen.getByRole('region', { name: 'Image options' });
  expect(within(panel).getByText('3 left today', { exact: false }).textContent).not.toMatch(/credits/); // ComfyUI is free
  fireEvent.click(within(panel).getByRole('button', { name: 'kie.ai' }));
  expect(within(panel).getByText(/≈ 0.8 credits/)).toBeTruthy();
  fireEvent.click(within(panel).getByRole('button', { name: 'High' }));
  expect(within(panel).getByText(/^5.5 credits/)).toBeTruthy();
});

// P3-36b: starting from a picture.
test('Start from a picture: attach one, pick a strength; the request carries it and no shape', async () => {
  const run = vi.fn(async () => ({ jobId: 1 }));
  const { box, type } = setup({ imagine: imagineState(info({ canVary: true }), run) });
  type('/imagine make it a watercolor');
  const group = screen.getByRole('group', { name: 'Start from a picture' });
  const file = new File(['x'], 'My Photo.png', { type: 'image/png' });
  fireEvent.change(within(group).getByLabelText('Start from a picture'), { target: { files: [file] } });
  expect(await within(group).findByText('My Photo.png')).toBeTruthy();
  expect(screen.queryByRole('group', { name: 'Shape' })).toBeNull(); // the shape follows the picture
  fireEvent.click(within(group).getByRole('button', { name: 'Strong' }));
  fireEvent.keyDown(box, { key: 'Enter' });
  await waitFor(() => expect(run).toHaveBeenCalledWith({ prompt: 'make it a watercolor', quality: 'standard', init: { url: '/uploads/abc/My%20Photo.png', strength: 'strong' } }));
  await waitFor(() => expect(box.value).toBe(''));
  type('/imagine again');
  expect(within(screen.getByRole('group', { name: 'Start from a picture' })).getByLabelText('Start from a picture')).toBeTruthy(); // cleared after sending
});

test('replying to a message with a picture starts from it (Medium by default) unless switched off', async () => {
  const run = vi.fn(async () => ({ jobId: 1 }));
  const imagine = imagineState(info({ canVary: true }), run);
  const onCancelReply = vi.fn();
  render(<Composer channel="general" onSend={vi.fn()} imagine={imagine} replyingTo={{ id: 42, author: 'bob', picture: '/uploads/x/cat.png' }} onCancelReply={onCancelReply} />);
  const box = screen.getByRole('textbox', { name: 'Message #general' });
  fireEvent.change(box, { target: { value: '/imagine as a robot' } });
  const group = screen.getByRole('group', { name: 'Start from a picture' });
  expect(within(group).getByText('From the picture you’re replying to')).toBeTruthy();
  fireEvent.keyDown(box, { key: 'Enter' });
  await waitFor(() => expect(run).toHaveBeenCalledWith({ prompt: 'as a robot', quality: 'standard', init: { messageId: 42, strength: 'medium' } }));
  await waitFor(() => expect(onCancelReply).toHaveBeenCalledTimes(1)); // the reply bar closes once its picture is used
  fireEvent.change(box, { target: { value: '/imagine as a robot' } });
  fireEvent.click(within(screen.getByRole('group', { name: 'Start from a picture' })).getByRole('button', { name: 'Don’t start from this picture' }));
  fireEvent.keyDown(box, { key: 'Enter' });
  await waitFor(() => expect(run).toHaveBeenLastCalledWith({ prompt: 'as a robot', shape: 'square', quality: 'standard' }));
});

test('no picture option without ComfyUI (canVary false)', () => {
  const { type } = setup();
  type('/imagine a cat');
  expect(screen.queryByRole('group', { name: 'Start from a picture' })).toBeNull();
});


test('P9-04c: the Style row: ComfyUI with 2+ styles; the default first, then the last one used here; sent as `preset`', async () => {
  localStorage.removeItem('disgourd.imagineStyle');
  const styles = [{ id: 'default', name: 'Default' }, { id: 'photo', name: 'Photoreal' }, { id: 'anime', name: 'Anime' }];
  const engines = [{ id: 'comfyui', name: 'ComfyUI' }, { id: 'kie', name: 'kie.ai' }];
  const run = vi.fn(async () => ({}));
  const first = setup({ imagine: imagineState(info({ engines, styles, defaultStyle: 'photo' }), run) });
  first.type('/imagine a boat');
  const row = screen.getByRole('group', { name: 'Style' });
  expect(within(row).getAllByRole('button').map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([['Default', 'false'], ['Photoreal', 'true'], ['Anime', 'false']]);
  fireEvent.keyDown(first.box, { key: 'Enter' });
  await waitFor(() => expect(run).toHaveBeenLastCalledWith({ prompt: 'a boat', shape: 'square', quality: 'standard', preset: 'photo' }));
  // Pick Anime: sent, and remembered on this device.
  first.type('/imagine a cat');
  fireEvent.click(within(screen.getByRole('group', { name: 'Style' })).getByRole('button', { name: 'Anime' }));
  fireEvent.keyDown(first.box, { key: 'Enter' });
  await waitFor(() => expect(run).toHaveBeenLastCalledWith({ prompt: 'a cat', shape: 'square', quality: 'standard', preset: 'anime' }));
  // kie.ai has no styles: no row, nothing sent.
  first.type('/imagine a dog');
  fireEvent.click(within(screen.getByRole('group', { name: 'Engine' })).getByRole('button', { name: 'kie.ai' }));
  expect(screen.queryByRole('group', { name: 'Style' })).toBeNull();
  fireEvent.keyDown(first.box, { key: 'Enter' });
  await waitFor(() => expect(run).toHaveBeenLastCalledWith({ prompt: 'a dog', shape: 'square', quality: 'standard', engine: 'kie' }));
  cleanup();
  // A new box starts on Anime (remembered); a remembered style that's gone falls back to the default.
  const second = setup({ imagine: imagineState(info({ styles, defaultStyle: 'photo' }), run) });
  second.type('/imagine a fish');
  expect(within(screen.getByRole('group', { name: 'Style' })).getByRole('button', { name: 'Anime' }).getAttribute('aria-pressed')).toBe('true');
  cleanup();
  setup({ imagine: imagineState(info({ styles: styles.slice(0, 2), defaultStyle: 'photo' }), run) }).type('/imagine a fish');
  expect(within(screen.getByRole('group', { name: 'Style' })).getByRole('button', { name: 'Photoreal' }).getAttribute('aria-pressed')).toBe('true');
  cleanup();
  // One style: no row, and no `preset` (the server uses its only style).
  const single = setup({ imagine: imagineState(info({ styles: [{ id: 'default', name: 'Default' }], defaultStyle: 'default' }), run) });
  single.type('/imagine a frog');
  expect(screen.queryByRole('group', { name: 'Style' })).toBeNull();
  fireEvent.keyDown(single.box, { key: 'Enter' });
  await waitFor(() => expect(run).toHaveBeenLastCalledWith({ prompt: 'a frog', shape: 'square', quality: 'standard' }));
  localStorage.removeItem('disgourd.imagineStyle');
});
