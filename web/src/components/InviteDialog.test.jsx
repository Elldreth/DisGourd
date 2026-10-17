import { afterEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../util.js', () => ({ copyText: vi.fn(async () => true) }));
const { copyText } = await import('../util.js');
const { default: InviteDialog } = await import('./InviteDialog.jsx');

afterEach(cleanup);

test('shows a link and the code, each with its own Copy button', async () => {
  render(<InviteDialog space="Tx Check" code="abc123" onClose={() => {}} />);
  const link = `${window.location.origin}/invite/abc123`;
  expect(screen.getByText(link)).toBeTruthy();
  expect(screen.getByText('abc123')).toBeTruthy();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
  });
  expect(copyText).toHaveBeenLastCalledWith(link);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
  });
  expect(copyText).toHaveBeenLastCalledWith('abc123');
});
