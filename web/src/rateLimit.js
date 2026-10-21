// P11-03: the server drops frames sent too fast and answers
// { type: 'error', op, code: 'RATE_LIMITED', retryAfter } (at most once a
// second per op). The words for the toast, or null for any other frame.
export function rateLimitNotice(f) {
  if (!f || f.code !== 'RATE_LIMITED') return null;
  const wait = Math.max(1, Math.round(Number(f.retryAfter) || 1));
  if (f.op === 'message' || f.op === 'dm') return `You’re sending messages too fast: that one wasn’t sent. Try again in ${wait} s.`;
  if (f.op === 'react') return `Slow down: too many reactions at once. Try again in ${wait} s.`;
  return `Slow down: that wasn’t done. Try again in ${wait} s.`;
}
