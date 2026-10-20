// P7-02: the keyboard shortcuts sheet, and "Keyboard shortcuts" in the status menu.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import ShortcutsSheet from './ShortcutsSheet.jsx';
import UserFooter from './UserFooter.jsx';
import { SHORTCUT_GROUPS, keyNames } from '../shortcuts.js';

beforeEach(() => localStorage.clear());
afterEach(cleanup);

test('the sheet lists every shortcut in the shared list, grouped, with Ctrl off a Mac', () => {
  render(<ShortcutsSheet onClose={() => {}} mac={false} />);
  const dialog = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
  for (const group of SHORTCUT_GROUPS) {
    const section = within(dialog).getByRole('region', { name: group.title });
    for (const it of group.items) {
      const row = within(section).getByText(it.label).parentElement;
      expect([...row.querySelectorAll('kbd')].map((k) => k.textContent)).toEqual(keyNames(it.keys, false));
    }
  }
  expect(within(dialog).getByText('Jump to a channel, server or person').parentElement.textContent).toContain('CtrlK');
  expect(within(dialog).getByText(/Off · set it in Voice & audio/)).toBeTruthy();
});

test('on a Mac the Ctrl/Cmd shortcuts show ⌘, and a push-to-talk key is shown when set', () => {
  localStorage.setItem('disgourd.pttEnabled', '1');
  localStorage.setItem('disgourd.pttKey', 'KeyV');
  render(<ShortcutsSheet onClose={() => {}} mac />);
  expect([...screen.getByText('New direct message').parentElement.querySelectorAll('kbd')].map((k) => k.textContent)).toEqual(['⌘', '⇧', 'K']);
  // Voice keeps Ctrl even on a Mac (that's the key it listens for).
  expect([...screen.getByText('Mute or unmute').parentElement.querySelectorAll('kbd')].map((k) => k.textContent)).toEqual(['Ctrl', '⇧', 'M']);
});

test('Close and Esc close it', () => {
  const onClose = vi.fn();
  render(<ShortcutsSheet onClose={onClose} mac={false} />);
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  fireEvent.keyDown(screen.getByRole('button', { name: 'Close' }), { key: 'Escape' });
  expect(onClose).toHaveBeenCalledTimes(2);
});

test('the status menu has Keyboard shortcuts, which opens the sheet', () => {
  const onOpenShortcuts = vi.fn();
  render(<UserFooter user="sandy" status="open" presence="online" onSetPresence={() => {}} onOpenShortcuts={onOpenShortcuts} onOpenProfile={() => {}} onLogout={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Set status (Online)' }));
  const menu = screen.getByRole('menu', { name: 'Set status' });
  const item = within(menu).getByRole('menuitem', { name: /Keyboard shortcuts/ });
  fireEvent.click(item);
  expect(onOpenShortcuts).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('menu')).toBeNull();
});

test('the status menu item shows Ctrl+/ as its hint', () => {
  render(<UserFooter user="sandy" status="open" presence="online" onSetPresence={() => {}} onOpenShortcuts={() => {}} onOpenProfile={() => {}} onLogout={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Set status (Online)' }));
  expect(screen.getByRole('menuitem', { name: /Keyboard shortcuts/ }).textContent).toContain('Ctrl+/');
});
