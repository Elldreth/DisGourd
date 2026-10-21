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

test('the rail opens no dialog by itself (an invite link joins directly since P14-02)', () => {
  renderRail();
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('the mention badge sits on top of the icon, outside its rounded mask; none on the open server', () => {
  renderRail({ spaces: [{ name: 'Tx' }, { name: 'Calm' }], currentSpace: 'Calm', mentions: { Tx: 4, Calm: 2 } });
  const icon = screen.getByRole('button', { name: /^Tx,/ });
  const badge = screen.getByTestId('mentions-badge-Tx');
  expect(badge.textContent).toBe('4');
  expect(icon.contains(badge)).toBe(false);
  expect(badge.parentElement).toBe(icon.parentElement);
  expect(screen.queryByTestId('mentions-badge-Calm')).toBeNull();
});
