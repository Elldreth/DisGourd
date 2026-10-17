import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import DmPanel from './DmPanel.jsx';

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

const T = new Date('2026-10-16T14:00:00').getTime();

test('replying to a DM shows who you are replying to and sends the original id (P2-10)', async () => {
  const onSend = vi.fn();
  render(
    <DmPanel
      username="bob"
      currentUser="sandy"
      messages={[{ id: 7, author: 'bob', content: 'lunch?', timestamp: T }]}
      onSend={onSend}
      onOpenSearch={() => {}}
      onOpenNav={() => {}}
    />
  );
  const row = document.querySelector('[data-msg-id="7"]');
  fireEvent.keyDown(row, { key: 'r' });
  expect(screen.getByText(/Replying to/).textContent).toMatch(/@bob/);
  const box = screen.getByRole('textbox', { name: 'Message @bob' });
  fireEvent.change(box, { target: { value: 'yes!' } });
  await act(async () => {
    fireEvent.keyDown(box, { key: 'Enter' });
  });
  expect(onSend).toHaveBeenCalledWith('yes!', [], false, 7);
  expect(screen.queryByText(/Replying to/)).toBeNull(); // cleared after sending
});
