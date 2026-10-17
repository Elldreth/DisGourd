import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useGateway } from './useSocket.js';

// A WebSocket stand-in the test opens and drops by hand.
let sockets;
class FakeSocket {
  static OPEN = 1;
  constructor() {
    this.readyState = 0;
    sockets.push(this);
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  drop() {
    this.readyState = 3;
    this.onclose?.();
  }
  send() {}
  close() {
    this.drop();
  }
}

beforeEach(() => {
  sockets = [];
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', FakeSocket);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('reconnects counts the times the socket opens again after the first', () => {
  const { result } = renderHook(() => useGateway({ token: 't', handlers: {} }));
  expect(result.current.reconnects).toBe(0);

  act(() => sockets[0].open());
  expect(result.current.status).toBe('open');
  expect(result.current.reconnects).toBe(0); // the first connect isn't a reconnect

  act(() => sockets[0].drop());
  expect(result.current.status).toBe('reconnecting');
  act(() => vi.advanceTimersByTime(20000));
  act(() => sockets[1].open());
  expect(result.current.status).toBe('open');
  expect(result.current.reconnects).toBe(1);

  act(() => sockets[1].drop());
  act(() => vi.advanceTimersByTime(20000));
  act(() => sockets[2].open());
  expect(result.current.reconnects).toBe(2);
});

test('when the browser reports the network is back, it retries straight away', () => {
  renderHook(() => useGateway({ token: 't', handlers: {} }));
  act(() => sockets[0].open());
  act(() => sockets[0].drop()); // first retry is scheduled ~0.5s out…
  act(() => vi.advanceTimersByTime(1000));
  act(() => sockets[1].drop()); // …and fails, so the next one waits longer
  expect(sockets).toHaveLength(2);

  act(() => window.dispatchEvent(new Event('online')));
  expect(sockets).toHaveLength(3); // no waiting for the backoff timer
  act(() => sockets[2].open());
  act(() => vi.advanceTimersByTime(20000));
  expect(sockets).toHaveLength(3); // the cancelled timer doesn't open a second socket
});

test('an online event while connected does nothing', () => {
  renderHook(() => useGateway({ token: 't', handlers: {} }));
  act(() => sockets[0].open());
  act(() => window.dispatchEvent(new Event('online')));
  expect(sockets).toHaveLength(1);
});
