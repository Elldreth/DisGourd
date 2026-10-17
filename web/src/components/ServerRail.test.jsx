import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

vi.mock('../api.js', () => ({
  previewInvite: vi.fn(async () => ({ space: 'Tx Check', members: 2, alreadyMember: false })),
}));
const { default: ServerRail } = await import('./ServerRail.jsx');

afterEach(cleanup);

function renderRail(props = {}) {
  const handlers = { onSelect: vi.fn(), onCreate: vi.fn(), onJoin: vi.fn(), onSelectDms: vi.fn(), onInviteOpened: vi.fn() };
  render(<ServerRail spaces={[]} currentSpace="" {...handlers} {...props} />);
  return handlers;
}

test('a pending invite opens Add a server on Join, prefilled, and reports it was opened', async () => {
  const { onInviteOpened } = renderRail({ pendingInvite: 'abc123' });
  expect(screen.getByRole('dialog', { name: 'Add a server' })).toBeTruthy();
  expect(screen.getByRole('tab', { name: 'Join' }).getAttribute('aria-selected')).toBe('true');
  expect(screen.getByRole('textbox', { name: 'Invite code or link' }).value).toBe('abc123');
  expect(onInviteOpened).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(screen.getByText('Tx Check')).toBeTruthy());
});

test('no pending invite: no dialog', () => {
  const { onInviteOpened } = renderRail();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(onInviteOpened).not.toHaveBeenCalled();
});
