import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('../api.js', () => ({ getPins: vi.fn(async () => []), getThreads: vi.fn(async () => []), createThread: vi.fn() }));
const { default: ChatPanel } = await import('./ChatPanel.jsx');

afterEach(cleanup);

const base = { space: 'S', channel: 'general', status: 'open', messages: [], currentUser: 'sandy', onSend: () => {}, onOpenThread: () => {} };

test('the Threads button in the header shows how many threads have something unread (P2-22c)', () => {
  const { rerender } = render(<ChatPanel {...base} threadsUnread={0} />);
  expect(screen.getByRole('button', { name: 'Threads' })).toBeTruthy();
  rerender(<ChatPanel {...base} threadsUnread={2} />);
  expect(screen.getByRole('button', { name: 'Threads (2 unread)' })).toBeTruthy();
});
