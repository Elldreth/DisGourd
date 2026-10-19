// P3-23: Retry and Variations on the /imagine bot's messages.
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import MessageList from './MessageList.jsx';
import { imagineResultKind } from './ImagineAgain.jsx';

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

const at = 1700000000000;
const done = { id: 1, author: 'Imagine', bot: true, content: '🎨 **sandy** imagined: a gourd', attachments: ['/uploads/x/imagine-1.png'], timestamp: at, reactions: [] };
const failed = { id: 2, author: 'Imagine', bot: true, content: "⚠️ Couldn't imagine that for **bob**: it took too long", attachments: [], timestamp: at + 1000, reactions: [] };
const waiting = { id: 3, author: 'Imagine', bot: true, content: '🎨 Imagining for **cara**… generating', attachments: [], timestamp: at + 2000, reactions: [] };
const person = { id: 4, author: 'sandy', content: '🎨 **sandy** imagined: a fake', attachments: ['/uploads/y/a.png'], timestamp: at + 3000, reactions: [] };

test('which bot messages are finished or failed requests', () => {
  expect(imagineResultKind(done)).toBe('done');
  expect(imagineResultKind(failed)).toBe('failed');
  expect(imagineResultKind(waiting)).toBe(null);
  expect(imagineResultKind(person)).toBe(null); // only the bot's own messages
  expect(imagineResultKind({ ...done, attachments: [] })).toBe(null);
});

test('Variations on an image, Retry on a failure; a press repeats it, and a refusal shows', async () => {
  const run = vi.fn().mockResolvedValueOnce({ jobId: 9 }).mockRejectedValueOnce(Object.assign(new Error('You’ve used all 10 images for today.'), { code: 'LIMIT' }));
  render(<MessageList messages={[done, failed, waiting, person]} channel="general" currentUser="sandy" imagineAgain={run} />);
  expect(screen.getAllByRole('button', { name: /Variations/ })).toHaveLength(1);
  expect(screen.getAllByRole('button', { name: /Retry/ })).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: /Variations/ }));
  expect(run).toHaveBeenCalledWith({ from: 1 });
  await screen.findByRole('button', { name: /Variations/ });
  fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
  expect(run).toHaveBeenLastCalledWith({ from: 2 });
  expect((await screen.findByRole('alert')).textContent).toBe('You’ve used all 10 images for today.');
});

test('no buttons while /imagine is not available here', () => {
  render(<MessageList messages={[done, failed]} channel="general" currentUser="sandy" />);
  expect(screen.queryByRole('button', { name: /Variations|Retry/ })).toBeNull();
});

// P3-29: the Upscale button.
const upscaled = { id: 5, author: 'Imagine', bot: true, content: '🔍 **bob** upscaled: a gourd', attachments: ['/uploads/z/imagine-1.png'], timestamp: at + 4000, reactions: [] };

test('Upscale 2× on generated images when ComfyUI can upscale; upscaled ones get Variations only', async () => {
  expect(imagineResultKind(upscaled)).toBe('upscaled');
  const run = vi.fn().mockResolvedValue({ jobId: 1 });
  render(<MessageList messages={[done, failed, upscaled]} channel="general" currentUser="sandy" imagineAgain={run} imagineUpscale />);
  expect(screen.getAllByRole('button', { name: /Upscale 2×/ })).toHaveLength(1); // not on the failure or the upscaled one
  expect(screen.getAllByRole('button', { name: /Variations/ })).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: /Upscale 2×/ }));
  expect(run).toHaveBeenCalledWith({ from: 1, upscale: true });
  await screen.findByRole('button', { name: /Upscale 2×/ });
  cleanup();
  render(<MessageList messages={[done]} channel="general" currentUser="sandy" imagineAgain={run} />);
  expect(screen.queryByRole('button', { name: /Upscale/ })).toBeNull(); // no ComfyUI to upscale with
});

// P3-36a: Subtle / Strong variations (img2img from the image itself).
const varied = { id: 6, author: 'Imagine', bot: true, content: '🎲 **cara** varied (strong): a gourd', attachments: ['/uploads/v/disgourd-1.png'], timestamp: at + 5000, reactions: [] };

test('with ComfyUI: Subtle and Strong variation on generated, varied and upscaled images; Upscale not on upscaled ones', async () => {
  expect(imagineResultKind(varied)).toBe('varied');
  expect(imagineResultKind({ ...varied, content: '🎲 **cara** varied (wild): x' })).toBe(null);
  const run = vi.fn().mockResolvedValue({ jobId: 1 });
  render(<MessageList messages={[done, failed, upscaled, varied]} channel="general" currentUser="sandy" imagineAgain={run} imagineUpscale imagineVary />);
  expect(screen.getAllByRole('button', { name: /Subtle variation/ })).toHaveLength(3);
  expect(screen.getAllByRole('button', { name: /Strong variation/ })).toHaveLength(3);
  expect(screen.queryByRole('button', { name: /^🎲 Variations/ })).toBeNull(); // replaced
  expect(screen.getAllByRole('button', { name: /Upscale 2×/ })).toHaveLength(2); // generated and varied, not upscaled
  expect(screen.getAllByRole('button', { name: /Retry/ })).toHaveLength(1);
  fireEvent.click(screen.getAllByRole('button', { name: /Subtle variation/ })[0]);
  expect(run).toHaveBeenCalledWith({ from: 1, vary: 'subtle' });
  await screen.findAllByRole('button', { name: /Subtle variation/ });
  fireEvent.click(screen.getAllByRole('button', { name: /Strong variation/ })[2]);
  expect(run).toHaveBeenLastCalledWith({ from: 6, vary: 'strong' });
});

test('without ComfyUI: the single Variations (a new take) stays', () => {
  render(<MessageList messages={[done]} channel="general" currentUser="sandy" imagineAgain={vi.fn()} />);
  expect(screen.getByRole('button', { name: /🎲 Variations/ })).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Subtle variation/ })).toBeNull();
});

