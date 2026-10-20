// P6-04: a slow-mode countdown keeps running when its channel or server is renamed.
import { afterEach, expect, test, vi } from 'vitest';
import { clearCooldowns, cooldownKey, cooldownLeft, renameCooldowns, startCooldown } from './slowmode.js';

afterEach(() => {
  clearCooldowns();
  vi.useRealTimers();
});

test('a channel rename moves only that channel’s countdown', () => {
  vi.useFakeTimers();
  startCooldown(cooldownKey('S', 'general'), 30_000);
  startCooldown(cooldownKey('S', 'random'), 5_000);
  renameCooldowns('S', 'general', 'S', 'game-night');
  expect(cooldownLeft(cooldownKey('S', 'general'))).toBe(0);
  expect(cooldownLeft(cooldownKey('S', 'game-night'))).toBe(30);
  expect(cooldownLeft(cooldownKey('S', 'random'))).toBe(5);
});

test('a server rename moves every countdown in it, and no other server’s', () => {
  vi.useFakeTimers();
  startCooldown(cooldownKey('S', 'general'), 30_000);
  startCooldown(cooldownKey('S', '~t5'), 60_000);
  startCooldown(cooldownKey('T', 'general'), 5_000);
  renameCooldowns('S', null, 'Studio');
  expect(cooldownLeft(cooldownKey('Studio', 'general'))).toBe(30);
  expect(cooldownLeft(cooldownKey('Studio', '~t5'))).toBe(60);
  expect(cooldownLeft(cooldownKey('S', 'general'))).toBe(0);
  expect(cooldownLeft(cooldownKey('T', 'general'))).toBe(5);
});
