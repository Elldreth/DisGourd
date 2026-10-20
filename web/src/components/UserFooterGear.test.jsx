// P5-02: the footer's icon opens Settings (a gear); Sign out moved into
// Settings › My account and the bottom of the status menu.
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import UserFooter from './UserFooter.jsx';

afterEach(cleanup);

function setup() {
  const onOpenProfile = vi.fn();
  const onLogout = vi.fn();
  render(<UserFooter user="sandy" status="open" presence="online" onSetPresence={() => {}} onEditStatus={() => {}} onOpenProfile={onOpenProfile} onLogout={onLogout} />);
  return { onOpenProfile, onLogout };
}

test('the footer has a Settings gear and no one-click sign-out', () => {
  const { onOpenProfile, onLogout } = setup();
  expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  expect(onOpenProfile).toHaveBeenCalledTimes(1);
  expect(onLogout).not.toHaveBeenCalled();
});

test('the status menu ends with Sign out', () => {
  const { onLogout } = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Set status (Online)' }));
  const menu = screen.getByRole('menu', { name: 'Set status' });
  const items = [...menu.querySelectorAll('[role^=menuitem]')];
  expect(items[items.length - 1].textContent).toMatch(/Sign out/);
  fireEvent.click(within(menu).getByRole('menuitem', { name: 'Sign out' }));
  expect(onLogout).toHaveBeenCalledTimes(1);
});
