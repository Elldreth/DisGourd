// Slow mode countdowns (P3-26d), per channel or thread, shared by every panel:
// when I may next post there. Set after I send, or from the server's refusal.
import { useEffect, useState } from 'react';

const ends = new Map(); // key -> ms when I may post again
const listeners = new Set();

export const cooldownKey = (space, channel) => `${space}\u0000${channel}`;

export function startCooldown(key, ms) {
  ends.set(key, Date.now() + ms);
  listeners.forEach((fn) => fn());
}

// Whole seconds left before I may post at `key` (0 = now). Ticks each second.
export function cooldownLeft(key, now = Date.now()) {
  const end = ends.get(key) || 0;
  return end > now ? Math.ceil((end - now) / 1000) : 0;
}

export function useCooldown(key) {
  const [, setTick] = useState(0);
  const left = cooldownLeft(key);
  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    listeners.add(bump);
    return () => listeners.delete(bump);
  }, []);
  useEffect(() => {
    if (!left) return undefined;
    // Wake when the shown number next changes (the next whole second left).
    const untilNext = (ends.get(key) - Date.now()) % 1000 || 1000;
    const t = setTimeout(() => setTick((n) => n + 1), untilNext + 10);
    return () => clearTimeout(t);
  });
  return left;
}

// For tests.
export function clearCooldowns() {
  ends.clear();
}
