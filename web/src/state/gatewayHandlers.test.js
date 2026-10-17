import { expect, test, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { composeHandlers, useHandlerTable } from './gatewayHandlers.js';

test('two maps that handle the same frame type both run, in order', () => {
  const calls = [];
  const channel = { message: (f) => calls.push(['channel', f.id]), typing: () => calls.push(['channel-typing']) };
  const thread = { message: (f) => calls.push(['thread', f.id]) };
  const out = composeHandlers(channel, thread);
  out.message({ id: 7 });
  out.typing({});
  expect(calls).toEqual([['channel', 7], ['thread', 7], ['channel-typing']]);
});

test('the table keeps the same object across fills, so useGateway never has to re-read it', () => {
  const { result } = renderHook(() => useHandlerTable());
  const { handlers, fill } = result.current;
  const a = vi.fn();
  const b = vi.fn();
  fill({ message: a });
  handlers.message({ id: 1 });
  fill({ message: a }, { message: b }, { unread: null });
  handlers.message({ id: 2 });
  expect(result.current.handlers).toBe(handlers);
  expect(a.mock.calls.map((c) => c[0].id)).toEqual([1, 2]);
  expect(b.mock.calls.map((c) => c[0].id)).toEqual([2]);
  expect('unread' in handlers).toBe(false); // nothing to call: left out
});
