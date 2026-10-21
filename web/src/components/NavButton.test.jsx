// P10-07: on phones the ☰ shows a dot when something waits in the drawer.
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import NavButton, { navAlert } from './NavButton.jsx';

afterEach(cleanup);

test('red for unread DMs or mentions (red wins), amber for open reports, else nothing', () => {
  expect(navAlert({})).toBeNull();
  expect(navAlert({ openReports: 2 })).toBe('amber');
  expect(navAlert({ dmUnread: 1, openReports: 2 })).toBe('red');
  expect(navAlert({ mentions: 3 })).toBe('red');
});

test('the dot shows, and the label says why', () => {
  const onClick = vi.fn();
  const { container, rerender } = render(<NavButton label="Channels" onClick={onClick} />);
  expect(screen.getByRole('button', { name: 'Channels' })).toBeTruthy();
  expect(container.querySelector('[data-nav-alert]')).toBeNull();
  rerender(<NavButton label="Channels" alert="red" onClick={onClick} />);
  expect(screen.getByRole('button', { name: 'Channels (unread)' })).toBeTruthy();
  expect(container.querySelector('[data-nav-alert="red"]').className).toMatch(/bg-danger/);
  rerender(<NavButton label="Channels" alert="amber" onClick={onClick} />);
  fireEvent.click(screen.getByRole('button', { name: 'Channels (open reports)' }));
  expect(onClick).toHaveBeenCalled();
});
