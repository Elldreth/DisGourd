import { expect, test } from 'vitest';
import { rateLimitNotice } from './rateLimit.js';

// P11-03: the server drops frames sent too fast and says so with RATE_LIMITED.
test('a refused message or DM says it wasn’t sent and when to try again', () => {
  expect(rateLimitNotice({ type: 'error', op: 'message', code: 'RATE_LIMITED', retryAfter: 4 })).toBe(
    'You’re sending messages too fast: that one wasn’t sent. Try again in 4 s.'
  );
  expect(rateLimitNotice({ type: 'error', op: 'dm', code: 'RATE_LIMITED', retryAfter: 1 })).toMatch(/Try again in 1 s/);
});

test('reactions and group changes get their own words', () => {
  expect(rateLimitNotice({ op: 'react', code: 'RATE_LIMITED', retryAfter: 2 })).toMatch(/^Slow down: too many reactions/);
  expect(rateLimitNotice({ op: 'dm_group_add', code: 'RATE_LIMITED', retryAfter: 30 })).toMatch(/^Slow down/);
});

test('anything else is not a rate-limit notice', () => {
  expect(rateLimitNotice({ op: 'message', code: 'SLOWMODE', retryAfter: 5 })).toBeNull();
  expect(rateLimitNotice({ op: 'message' })).toBeNull();
  expect(rateLimitNotice(null)).toBeNull();
});
