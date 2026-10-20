// P7-03: Pins and Threads open beside the chat (where the thread panel goes),
// so you can jump from pin to pin with the list still open. One side column at
// a time; Esc and the X close it; on phones it's full screen with a back button.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const pins = [
  { id: 9, author: 'ann', content: 'Rules', timestamp: 1, pinnedBy: 'ann', pinnedAt: 2 },
  { id: 4, author: 'ben', content: 'Map', timestamp: 1, pinnedBy: 'ann', pinnedAt: 1 },
];
const threads = [{ id: 3, channel: '~t40', name: 'Plans', rootMessageId: 40, messageCount: 2, lastActivityAt: 1 }];
vi.mock('../api.js', () => ({ getPins: vi.fn(async () => pins), getThreads: vi.fn(async () => threads), createThread: vi.fn(), getMessagesAround: vi.fn(async () => []) }));
const { default: ChatPanel } = await import('./ChatPanel.jsx');

let phone = false;
beforeEach(() => {
  phone = false;
  window.matchMedia = vi.fn((q) => ({ matches: phone && q.includes('max-width'), addEventListener() {}, removeEventListener() {} }));
});
afterEach(cleanup);

const base = { space: 'S', channel: 'general', status: 'open', messages: [], currentUser: 'sandy', onSend: () => {}, onOpenThread: () => {} };
const pinsButton = () => screen.getAllByRole('button', { name: 'Pinned messages' }).find((b) => b.getAttribute('aria-expanded') !== null);

async function openPins(props = {}) {
  const view = render(<ChatPanel {...base} {...props} />);
  fireEvent.click(pinsButton());
  await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2));
  return view;
}

test('Pins opens as a side column next to the chat, not a dialog; the chat stays usable', async () => {
  const onCloseThread = vi.fn();
  await openPins({ onCloseThread });
  const panel = screen.getByRole('complementary', { name: 'Pinned messages' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(panel.className).toMatch(/lg:static/);
  expect(panel.className).toMatch(/lg:w-96/);
  expect(screen.getByRole('main').contains(panel)).toBe(false); // beside the chat, not over it
  expect(pinsButton().getAttribute('aria-expanded')).toBe('true');
  expect(onCloseThread).toHaveBeenCalledTimes(1); // an open thread makes room
  expect(document.activeElement).toBe(panel);
});

test('on desktop, jumping to pins keeps the list open', async () => {
  await openPins();
  fireEvent.click(screen.getByRole('button', { name: /Jump to ann's message/ }));
  fireEvent.click(screen.getByRole('button', { name: /Jump to ben's message/ }));
  expect(screen.getByRole('complementary', { name: 'Pinned messages' })).toBeTruthy();
});

test('on a phone (full screen), jumping closes the list so the message shows', async () => {
  phone = true;
  await openPins();
  fireEvent.click(screen.getByRole('button', { name: /Jump to ann's message/ }));
  expect(screen.queryByRole('complementary', { name: 'Pinned messages' })).toBeNull();
});

test('Esc, the X and the back button close it, and focus goes back to the Pins button', async () => {
  await openPins();
  fireEvent.keyDown(screen.getByRole('complementary', { name: 'Pinned messages' }), { key: 'Escape' });
  expect(screen.queryByRole('complementary')).toBeNull();

  pinsButton().focus();
  fireEvent.click(pinsButton());
  await screen.findByRole('complementary', { name: 'Pinned messages' });
  fireEvent.click(screen.getByRole('button', { name: 'Close pinned messages' }));
  expect(screen.queryByRole('complementary')).toBeNull();
  expect(document.activeElement).toBe(pinsButton());

  fireEvent.click(pinsButton());
  await screen.findByRole('complementary', { name: 'Pinned messages' });
  fireEvent.click(screen.getByRole('button', { name: 'Back to #general' }));
  expect(screen.queryByRole('complementary')).toBeNull();
});

test('the Pins button toggles; Threads replaces Pins; one side column at a time', async () => {
  await openPins();
  fireEvent.click(pinsButton());
  expect(screen.queryByRole('complementary')).toBeNull();
  fireEvent.click(pinsButton());
  await screen.findByRole('complementary', { name: 'Pinned messages' });
  const threadsButton = screen.getAllByRole('button', { name: 'Threads' }).find((b) => b.getAttribute('aria-expanded') !== null);
  fireEvent.click(threadsButton);
  await screen.findByRole('complementary', { name: 'Threads' });
  expect(screen.queryByRole('complementary', { name: 'Pinned messages' })).toBeNull();
});

test('opening a thread from the list swaps the list for the thread panel; an open thread closes the lists', async () => {
  const onOpenThread = vi.fn();
  const { rerender } = render(<ChatPanel {...base} onOpenThread={onOpenThread} />);
  fireEvent.click(screen.getAllByRole('button', { name: 'Threads' }).find((b) => b.getAttribute('aria-expanded') !== null));
  fireEvent.click(await screen.findByRole('button', { name: /Open thread Plans/ }));
  expect(onOpenThread).toHaveBeenCalledWith(threads[0], expect.any(Object));
  expect(screen.queryByRole('complementary', { name: 'Threads' })).toBeNull();

  fireEvent.click(pinsButton());
  await screen.findByRole('complementary', { name: 'Pinned messages' });
  await act(async () => rerender(<ChatPanel {...base} onOpenThread={onOpenThread} threadOpen />));
  expect(screen.queryByRole('complementary', { name: 'Pinned messages' })).toBeNull();
});
