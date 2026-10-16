import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import NotificationSettings from './NotificationSettings.jsx';
import { getNotifyLevel, getMessageSounds } from '../audio.js';

let requestPermission;
function mockNotification(permission, answer) {
  requestPermission = vi.fn(() => Promise.resolve(answer));
  vi.stubGlobal('Notification', Object.assign(function Notification() {}, { permission, requestPermission }));
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const choose = async (label) => {
  await act(async () => {
    fireEvent.click(screen.getByLabelText(label));
  });
};

test('nothing is asked on load, and it starts off', () => {
  mockNotification('default', 'granted');
  render(<NotificationSettings />);
  expect(requestPermission).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Off').checked).toBe(true);
});

test('choosing a level asks the browser once; allowing it saves the level', async () => {
  mockNotification('default', 'granted');
  render(<NotificationSettings />);
  await choose('Mentions and DMs');
  expect(requestPermission).toHaveBeenCalledTimes(1);
  expect(getNotifyLevel()).toBe('mentions');
  expect(screen.getByLabelText('Mentions and DMs').checked).toBe(true);
});

test('blocking it keeps notifications off and explains how to fix it', async () => {
  mockNotification('default', 'denied');
  render(<NotificationSettings />);
  await choose('All messages');
  expect(getNotifyLevel()).toBe('off');
  expect(screen.getByText(/blocked/i)).toBeTruthy();
});

test('when already blocked, it never asks again', async () => {
  mockNotification('denied', 'denied');
  render(<NotificationSettings />);
  expect(screen.getByText(/blocked/i)).toBeTruthy();
  await choose('Mentions and DMs');
  expect(requestPermission).not.toHaveBeenCalled();
  expect(getNotifyLevel()).toBe('off');
});

test('the sound toggle works without notification permission', async () => {
  vi.stubGlobal('Notification', undefined);
  render(<NotificationSettings />);
  expect(screen.getByText(/doesn't support/i)).toBeTruthy();
  await act(async () => {
    fireEvent.click(screen.getByLabelText(/message sounds/i));
  });
  expect(getMessageSounds()).toBe(true);
});
