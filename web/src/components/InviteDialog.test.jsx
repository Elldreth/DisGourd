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

// P11-13 (L7): invites expire after 7 days unless you pick otherwise.
test('says when the invite expires, and picking another expiry asks for a new one', async () => {
  const onExpiry = vi.fn();
  const { rerender } = render(<InviteDialog space="Tx Check" code="abc123" expiresInDays={7} onExpiry={onExpiry} onClose={() => {}} />);
  const select = screen.getByLabelText('Expires after');
  expect(select.value).toBe('7');
  expect([...select.options].map((o) => o.textContent)).toEqual(['1 day', '7 days', '30 days', 'Never']);
  fireEvent.change(select, { target: { value: 'never' } });
  expect(onExpiry).toHaveBeenLastCalledWith(null);
  fireEvent.change(select, { target: { value: '30' } });
  expect(onExpiry).toHaveBeenLastCalledWith(30);
  rerender(<InviteDialog space="Tx Check" code="def456" expiresInDays={null} onExpiry={onExpiry} onClose={() => {}} />);
  expect(screen.getByLabelText('Expires after').value).toBe('never');
  expect(screen.getByText('def456')).toBeTruthy();
});
